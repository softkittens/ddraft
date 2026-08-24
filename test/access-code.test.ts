import { describe, it, expect } from "bun:test";
import { handleAgentRequest } from "../src/agent/http";
import { makeDoc } from "./harness";

describe("ACCESS_CODE security gating & HttpOnly session cookie", () => {
  it("allows open access when ACCESS_CODE is not set in env", async () => {
    const res = await handleAgentRequest(new Request("http://pen.test/agent/status"), {
      env: {
        VERCEL_API_KEY: "sk-v"
      }
    });
    const body = (await res.json()) as {
      configured: boolean;
      providers: unknown[];
      requiresAccessCode?: boolean;
      authenticated?: boolean;
    };
    expect(body.requiresAccessCode).toBeUndefined();
    expect(body.configured).toBe(true);
    expect(body.providers.length).toBeGreaterThan(0);
  });

  it("exchanges access code at /agent/auth for an HttpOnly signed session cookie", async () => {
    const env = {
      ACCESS_CODE: "secure-pass-789",
      VERCEL_API_KEY: "sk-v"
    };

    // 1. Invalid code at /auth
    const badAuth = await handleAgentRequest(
      new Request("http://pen.test/agent/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "wrong-pass" })
      }),
      { env }
    );
    expect(badAuth.status).toBe(401);

    // 2. Correct code at /auth
    const authRes = await handleAgentRequest(
      new Request("http://pen.test/agent/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "secure-pass-789" })
      }),
      { env }
    );
    expect(authRes.status).toBe(200);
    const setCookie = authRes.headers.get("Set-Cookie");
    expect(setCookie).toContain("pen_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");

    // Extract cookie value
    const match = setCookie?.match(/pen_session=([^;]+)/);
    expect(match).toBeTruthy();
    const sessionCookie = `pen_session=${match![1]}`;

    // 3. Status request with HttpOnly session cookie
    const statusRes = await handleAgentRequest(
      new Request("http://pen.test/agent/status", {
        headers: { cookie: sessionCookie }
      }),
      { env }
    );
    const statusBody = (await statusRes.json()) as {
      configured: boolean;
      providers: unknown[];
      requiresAccessCode: boolean;
      authenticated: boolean;
    };
    expect(statusBody.requiresAccessCode).toBe(true);
    expect(statusBody.authenticated).toBe(true);
    expect(statusBody.configured).toBe(true);
    expect(statusBody.providers.length).toBeGreaterThan(0);

    // 4. Run request with tampered session cookie fails
    const tamperedRes = await handleAgentRequest(
      new Request("http://pen.test/agent/run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: "pen_session=tampered.signature"
        },
        body: JSON.stringify({
          messages: [{ role: "user", content: "test" }],
          doc: makeDoc()
        })
      }),
      { env }
    );
    expect(tamperedRes.status).toBe(401);

    // 5. Logout clears the cookie
    const logoutRes = await handleAgentRequest(
      new Request("http://pen.test/agent/logout", { method: "POST" }),
      { env }
    );
    expect(logoutRes.status).toBe(200);
    expect(logoutRes.headers.get("Set-Cookie")).toContain("pen_session=;");
  });

  it("blocks /run and /review with 401 when session cookie is missing", async () => {
    const env = {
      ACCESS_CODE: "app-access-key",
      VERCEL_API_KEY: "sk-v"
    };

    // Unauthorized /run
    const runRes = await handleAgentRequest(
      new Request("http://pen.test/agent/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "test" }],
          doc: makeDoc()
        })
      }),
      { env }
    );
    expect(runRes.status).toBe(401);
    const runBody = (await runRes.json()) as { error: string };
    expect(runBody.error).toBe("invalid_access_code");

    // Unauthorized /review
    const reviewRes = await handleAgentRequest(
      new Request("http://pen.test/agent/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brief: "test",
          digest: "test",
          screenshot: "data:image/png;base64,aVZCT1J3MEs="
        })
      }),
      { env }
    );
    expect(reviewRes.status).toBe(401);
    const reviewBody = (await reviewRes.json()) as { error: string };
    expect(reviewBody.error).toBe("invalid_access_code");
  });
});
