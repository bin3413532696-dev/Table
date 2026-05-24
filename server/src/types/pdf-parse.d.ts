declare module 'pdf-parse' {
  interface PdfInfo {
    Title?: string;
    Author?: string;
    Subject?: string;
    Keywords?: string;
    Creator?: string;
    Producer?: string;
    CreationDate?: string;
    ModDate?: string;
    PDFFormatVersion?: string;
    IsLinearized?: boolean;
    IsAcroFormPresent?: boolean;
    IsXFAPresent?: boolean;
    Custom?: Record<string, string>;
  }

  interface PdfData {
    text: string;
    numpages: number;
    numrender: number;
    info: PdfInfo;
    metadata: any;
    version: string;
  }

  function pdfParse(dataBuffer: Buffer, options?: any): Promise<PdfData>;
  export = pdfParse;
}