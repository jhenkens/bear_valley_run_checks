declare module '@alpinejs/csp' {
  const Alpine: {
    data(name: string, callback: () => object): void;
    start(): void;
  };
  export default Alpine;
}
