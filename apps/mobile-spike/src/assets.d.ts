// Metro turns an imported asset into a numeric module id (see metro.config.js).
declare module '*.jpg' {
  const id: number;
  export default id;
}
declare module '*.bin' {
  const id: number;
  export default id;
}
declare module '*.onnx' {
  const id: number;
  export default id;
}
