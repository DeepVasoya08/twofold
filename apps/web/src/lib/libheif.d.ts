// libheif-js ships no types for its WebAssembly build's entry point. lib/heif.ts describes
// the parts of the module it uses.
declare module 'libheif-js/libheif-wasm/libheif.js' {
  interface LibHeifOptions {
    locateFile: (path: string) => string;
    onRuntimeInitialized: () => void;
    onAbort: (reason: unknown) => void;
  }

  const factory: (options: LibHeifOptions) => unknown;
  export default factory;
}
