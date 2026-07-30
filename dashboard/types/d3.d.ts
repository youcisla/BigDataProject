declare module "d3-array" {
  export function extent(values: ArrayLike<number>): [number, number] | [undefined, undefined];
  export function min(values: ArrayLike<number>): number | undefined;
  export function max(values: ArrayLike<number>): number | undefined;
  export function mean(values: ArrayLike<number>): number | undefined;
  export function deviation(values: ArrayLike<number>): number | undefined;
  export function bin<T>(): {
    value: (fn: (d: T) => number) => ReturnType<typeof bin<T>>;
    domain: (domain: [number, number]) => ReturnType<typeof bin<T>>;
    thresholds: (n: number) => ReturnType<typeof bin<T>>;
    (data: ArrayLike<T>): Array<{ x0: number; x1: number; length: number; [k: string]: unknown }>;
  };
  export function scaleLinear(): {
    domain: (d: [number, number]) => ReturnType<typeof scaleLinear>;
    range: (r: [number, number]) => ReturnType<typeof scaleLinear>;
    nice: () => ReturnType<typeof scaleLinear>;
    ticks: (n?: number) => number[];
    (v: number): number;
  };
}

declare module "d3-scale" {
  export function scaleLinear(): {
    domain: (d: [number, number]) => ReturnType<typeof scaleLinear>;
    range: (r: [number, number]) => ReturnType<typeof scaleLinear>;
    nice: () => ReturnType<typeof scaleLinear>;
    ticks: (n?: number) => number[];
    (v: number): number;
  };
}

declare module "d3-shape" {
  export {};
}

declare module "d3-selection" {
  export {};
}

declare module "d3-chord" {
  export function chord(): {
    padAngle: (n: number) => ReturnType<typeof chord>;
    (matrix: number[][]): {
      ribbons: Array<{ source: { index: number }; target: { index: number }; path?: string }>;
      groups: Array<{ index: number; path?: string }>;
    };
  };
  export function ribbon(): (
    layout: ReturnType<ReturnType<typeof chord>>
  ) => Array<{ source: { index: number }; target: { index: number }; path?: string }>;
}
