import A_control_r1 from "../../fixtures/A_control_r1.pen?raw";
import A_control_r2 from "../../fixtures/A_control_r2.pen?raw";
import A_control_r3 from "../../fixtures/A_control_r3.pen?raw";
import B_contract_r1 from "../../fixtures/B_contract_r1.pen?raw";
import B_contract_r2 from "../../fixtures/B_contract_r2.pen?raw";
import B_contract_r3 from "../../fixtures/B_contract_r3.pen?raw";
import C_verify_r1 from "../../fixtures/C_verify_r1.pen?raw";
import C_verify_r2 from "../../fixtures/C_verify_r2.pen?raw";
import C_verify_r3 from "../../fixtures/C_verify_r3.pen?raw";
import D_hires_r1 from "../../fixtures/D_hires_r1.pen?raw";
import D_hires_r2 from "../../fixtures/D_hires_r2.pen?raw";
import D_hires_r3 from "../../fixtures/D_hires_r3.pen?raw";

export const FIXTURES_RAW: Record<string, string> = {
  A_control_r1,
  A_control_r2,
  A_control_r3,
  B_contract_r1,
  B_contract_r2,
  B_contract_r3,
  C_verify_r1,
  C_verify_r2,
  C_verify_r3,
  D_hires_r1,
  D_hires_r2,
  D_hires_r3
};

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

export async function fetchFixtureRaw(key: string): Promise<string> {
  return FIXTURES_RAW[key] || FIXTURES_RAW.A_control_r1;
}

export const DEFAULT_FIXTURE_KEY = "A_control_r1";
export const DEFAULT_FIXTURE_RAW = A_control_r1;
