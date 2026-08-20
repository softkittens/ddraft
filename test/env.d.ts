declare module "bun:test" {
  export function describe(name: string, fn: () => void): void;
  export function it(name: string, fn: () => void | Promise<void>): void;
  export function expect(actual: any): any;
}

declare module "fs" {
  export function readFileSync(path: string, encoding: string): string;
  export function readdirSync(path: string): string[];
}

declare module "path" {
  export function join(...paths: string[]): string;
}

interface ImportMeta {
  dir: string;
}
