declare module 'mammoth' {
  interface MammothOptions {
    path?: string;
    buffer?: Buffer;
  }

  interface MammothResult {
    value: string;
    messages: any[];
  }

  export function extractRawText(options: MammothOptions): Promise<MammothResult>;
  export function convertToHtml(options: MammothOptions): Promise<MammothResult>;
} 