import defaultRaw from "../../fixtures/A_control_r1.pen?raw";

export const FIXTURE_LABELS: Record<string, string> = {
  A_control_r1: "Factory Control (A_r1)",
  A_control_r2: "Factory Control (A_r2)",
  A_control_r3: "Factory Control (A_r3)",
  B_contract_r1: "Contract Dashboard (B_r1)",
  B_contract_r2: "Contract Dashboard (B_r2)",
  B_contract_r3: "Contract Dashboard (B_r3)",
  C_verify_r1: "Verification Layout (C_r1)",
  C_verify_r2: "Verification Layout (C_r2)",
  C_verify_r3: "Verification Layout (C_r3)",
  D_hires_r1: "High-Res Complex (D_r1)",
  D_hires_r2: "High-Res Complex (D_r2)",
  D_hires_r3: "High-Res Complex (D_r3)"
};

const lazyLoaders =
  typeof import.meta.glob === "function"
    ? (import.meta.glob("../../fixtures/*.pen", {
        query: "?raw",
        import: "default"
      }) as Record<string, () => Promise<string>>)
    : {};

export async function fetchFixtureRaw(key: string): Promise<string> {

  if (key === "A_control_r1") return defaultRaw;
  const path = `../../fixtures/${key}.pen`;
  const loader = lazyLoaders[path];
  if (!loader) return defaultRaw;
  return await loader();
}

export const FIXTURES: Record<string, { label: string; raw: string }> = new Proxy({} as any, {
  get: (_target, prop: string) => {
    return { label: FIXTURE_LABELS[prop] || prop, raw: defaultRaw };
  }
});

export const DEFAULT_FIXTURE_KEY = "A_control_r1";
export const DEFAULT_FIXTURE_RAW = defaultRaw;
