// Generador de etiqueta L-800 en formato .ezpx (GoDEX QLabel).
//
// Estrategia: renderizamos el PDF (misma función que usa el preview), lo
// convertimos a PNG @300 dpi y lo embebemos como única imagen en un .ezpx
// con la estructura mínima válida. Así el .ezpx es PIXEL-PERFECT idéntico
// al PDF, sin tener que mantener doble layout, y QLabel lo imprime directo
// en la GoDEX térmica.

import fs from 'node:fs';
import path from 'node:path';
import { pdfToPng } from 'pdf-to-png-converter';
import { buildEtiquetaL800Pdf, EtiquetaL800Datos } from './pdfEtiquetaL800';

// Plantilla .ezpx con todo lo de "configuración" (Scale, SerialFormat…)
// — sólo se reemplaza el bloque <qlabel>...</qlabel> con un único Image.
let templateCache: string | null = null;
function loadTemplate(): string {
  if (templateCache) return templateCache;
  const tplPath = path.join(__dirname, '..', 'assets', 'etiqueta_L800_template.ezpx');
  templateCache = fs.readFileSync(tplPath, 'utf8');
  return templateCache;
}

/**
 * Convierte el PDF de PDFKit a un Buffer.
 */
async function pdfToBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

/**
 * Construye el bloque <GraphicShape xsi:type="Image"> con la PNG embebida
 * en base64. Cubre todo el label (150×100 mm @ 300 dpi = 1772×1181 dots).
 */
function buildImageShape(pngBase64: string, widthDots: number, heightDots: number): string {
  return `      <GraphicShape xsi:type="Image" Style="Cross" IsPrint="true" PageAlignment="None" Locked="false" bStroke="true" bFill="true" Direction="Angle0" X="0" Y="0" Alignment="Left" AlignPointX="0" AlignPointY="0" FontScript="Default" FixedRatio="false">
        <qHitOnCircumferance>false</qHitOnCircumferance>
        <Selected>false</Selected>
        <iBackground_color>4294967295</iBackground_color>
        <Id>1</Id>
        <ItemLabel>Image_1</ItemLabel>
        <ObjectDrawMode>FW</ObjectDrawMode>
        <Name>L</Name>
        <GroupID>0</GroupID>
        <GroupSelected>false</GroupSelected>
        <bReplaceSpecialCharFromDB>false</bReplaceSpecialCharFromDB>
        <CharFilterRule>None</CharFilterRule>
        <LinkMode>OriginalData</LinkMode>
        <GraphicMode>false</GraphicMode>
        <ReplaceInfoItems />
        <FormatType>None</FormatType>
        <P1 />
        <P2 />
        <P3 />
        <P4 />
        <Culture>es-ES</Culture>
        <calendar>GregorianCalendar</calendar>
        <GetAiFromDigitalLink>false</GetAiFromDigitalLink>
        <DataField>None</DataField>
        <Prompt>None</Prompt>
        <BoundRectWidth>${widthDots}</BoundRectWidth>
        <DispData>etiqueta</DispData>
        <bRemovePreZeroAndEmpty>false</bRemovePreZeroAndEmpty>
        <Data />
        <ItemInfoList />
        <BoundRectHeight>${heightDots}</BoundRectHeight>
        <BoundRect>
          <Location>
            <X>0</X>
            <Y>0</Y>
          </Location>
          <Size>
            <Width>${widthDots}</Width>
            <Height>${heightDots}</Height>
          </Size>
          <X>0</X>
          <Y>0</Y>
          <Width>${widthDots}</Width>
          <Height>${heightDots}</Height>
        </BoundRect>
        <BitmapCmd>${pngBase64}</BitmapCmd>
        <FixedAspectRatio>false</FixedAspectRatio>
        <LoadToDevice>false</LoadToDevice>
        <FileName>etiqueta.png</FileName>
        <Identifier />
        <DitherType>Default</DitherType>
        <RotationFlip>RotateNoneFlipNone</RotationFlip>
        <Angle>0</Angle>
        <Binverse>false</Binverse>
      </GraphicShape>`;
}

/**
 * Genera .ezpx para la etiqueta L-800.
 * Internamente: PDF → PNG @ 300dpi → embebido en <Image> dentro del template.
 */
export async function buildEtiquetaL800Ezpx(datos: EtiquetaL800Datos): Promise<string> {
  // 1. Generar el PDF (misma función que el preview)
  const pdfDoc = await buildEtiquetaL800Pdf(datos);
  const pdfBuffer = await pdfToBuffer(pdfDoc);

  // 2. Rasterizar PDF → PNG @ 300 dpi (página única, máxima nitidez)
  // viewportScale: 1 = 96dpi por defecto. 300dpi / 96dpi ≈ 3.125
  const pages = await pdfToPng(pdfBuffer, {
    viewportScale: 3.125,
    outputFolder: undefined, // no guardar en disco
  });
  if (pages.length === 0 || !pages[0]?.content) throw new Error('No se pudo renderizar el PDF a PNG');
  const png = pages[0].content;
  const pngBase64 = png.toString('base64');

  // Dimensiones objetivo del label en dots (300dpi):
  // 150 mm × 300 / 25.4 ≈ 1772, 100 mm × 300 / 25.4 ≈ 1181
  const labelWidthDots = 1772;
  const labelHeightDots = 1181;

  // 3. Insertar en el template, reemplazando todo el bloque <qlabel>
  const template = loadTemplate();
  const imageShape = buildImageShape(pngBase64, labelWidthDots, labelHeightDots);
  const result = template.replace(
    /<qlabel>[\s\S]*?<\/qlabel>/,
    `<qlabel>\n${imageShape}\n    </qlabel>`
  );

  if (result === template) {
    throw new Error('No se encontró el bloque <qlabel> en la plantilla');
  }
  return result;
}
