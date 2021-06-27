declare module 'node-canvas-with-twemoji'{
  export interface Options {
    maxWidth : number,
    emojiSideMarginPercent : number,
    emojiTopMarginPercent : number
  }

  export function fillTextWithTwemoji(context : CanvasRenderingContext2D, text : string, x : number, y : number, options ?: Options) : Promise<void>;

  export function strokeTextWithTwemoji(context : CanvasRenderingContext2D, text : string, x : number, y : number, options ?: Options) : Promise<void>;

  export function measureText(context : CanvasRenderingContext2D, text : string, options ?: Options) : TextMetrics;
}
