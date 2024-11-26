import type { Hook } from "@oclif/core";
import PythonEcosystemSupport from "../ecosystem.js";

const hook: Hook<"register-ecosystem"> = async function () {
  return new PythonEcosystemSupport();
};

export default hook;
