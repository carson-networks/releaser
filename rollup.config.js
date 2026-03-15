import commonjs from "@rollup/plugin-commonjs";
import { nodeResolve } from "@rollup/plugin-node-resolve";

export default {
  input: ".tsc-out/index.js",
  output: {
    esModule: true,
    file: "dist/index.js",
    format: "es",
    sourcemap: true,
  },
  plugins: [nodeResolve({ preferBuiltins: true }), commonjs()],
  // "this" rewriting and circular deps are known artefacts of the @actions
  // toolkit's legacy CJS __awaiter pattern — safe to suppress.
  onwarn(warning, warn) {
    if (warning.code === "THIS_IS_UNDEFINED") return;
    if (warning.code === "CIRCULAR_DEPENDENCY") return;
    warn(warning);
  },
};
