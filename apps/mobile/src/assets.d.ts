/** Metro turns an imported image into a number that `<Image source>` accepts. */
declare module '*.png' {
  const source: number;
  export default source;
}
