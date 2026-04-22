export const caseStudy = {
  slug: 'estacion-servicio-castellon',
  title: 'Automatización de 167 facturas trimestrales · Estación de servicio familiar',
  titleEn: 'Automating 167 quarterly invoices · Family service station',
  location: 'Castellón, España',
  sector: 'Hostelería + Carburantes',
  sectorEn: 'Hospitality + Fuel',
  date: '2026-01',
  metrics: [
    { value: '10h', label: 'ahorradas por trimestre', labelEn: 'saved per quarter' },
    { value: '167', label: 'facturas procesadas automáticamente', labelEn: 'invoices processed automatically' },
    { value: '0', label: 'errores de transcripción', labelEn: 'transcription errors' },
  ],
  stack: ['Python 3.11', 'pdfplumber', 'openpyxl', 'imaplib', 'Claude API', 'pandas'],
  challenge: {
    es: `Una pyme familiar con estación de servicio y bar gestionaba 167 facturas trimestrales a mano. El proceso era siempre el mismo: entrar al correo, buscar los emails con facturas adjuntas, descargar cada PDF, abrir el archivo, copiar manualmente el nombre del proveedor, el número de factura, la fecha, el importe base y el IVA a una hoja de Excel, y repetir esto 167 veces.

El proceso completo les llevaba más de 10 horas cada trimestre, y siempre aparecían errores: una cifra copiada mal, un IVA equivocado, una factura olvidada. El gestor tenía que revisar todo antes de presentar los impuestos.`,
    en: `A family-owned SMB with a service station and bar managed 167 quarterly invoices by hand. The process was always the same: open email, search for emails with attached invoices, download each PDF, open the file, manually copy the supplier name, invoice number, date, base amount and VAT to an Excel sheet, and repeat this 167 times.

The entire process took over 10 hours each quarter, and errors always crept in: a wrong number, an incorrect VAT, a forgotten invoice. The accountant had to review everything before filing taxes.`,
  },
  solution: {
    es: `Desarrollamos un script Python que automatiza completamente el proceso:

1. **Monitorización del correo**: Usando \`imaplib\`, el script se conecta al servidor de correo y busca emails con PDFs adjuntos de los proveedores habituales.

2. **Extracción de datos**: Con \`pdfplumber\`, extraemos el texto de cada factura PDF. Los campos clave (proveedor, número, fecha, base, IVA) se identifican mediante expresiones regulares y patrones específicos.

3. **Validación con IA**: Para facturas con formatos inusuales o texto difícil de parsear, usamos la Claude API para validar y completar los datos extraídos.

4. **Volcado a Excel**: Con \`openpyxl\`, generamos automáticamente el Excel con el formato exacto que necesita el gestor: una fila por factura, columnas predefinidas, totales automáticos.`,
    en: `We developed a Python script that completely automates the process:

1. **Email monitoring**: Using \`imaplib\`, the script connects to the mail server and searches for emails with PDF attachments from regular suppliers.

2. **Data extraction**: With \`pdfplumber\`, we extract text from each PDF invoice. Key fields (supplier, number, date, base amount, VAT) are identified through regular expressions and specific patterns.

3. **AI validation**: For invoices with unusual formats or difficult-to-parse text, we use the Claude API to validate and complete the extracted data.

4. **Excel output**: With \`openpyxl\`, we automatically generate the Excel with the exact format the accountant needs: one row per invoice, predefined columns, automatic totals.`,
  },
  codeSnippet: `# Extracting invoice data with pdfplumber
import pdfplumber
import re
from dataclasses import dataclass

@dataclass
class InvoiceData:
    supplier: str
    invoice_number: str
    date: str
    base_amount: float
    vat_rate: float
    vat_amount: float
    total: float

def extract_invoice_data(pdf_path: str) -> InvoiceData:
    with pdfplumber.open(pdf_path) as pdf:
        text = ""
        for page in pdf.pages:
            text += page.extract_text() or ""

    # Extract key fields with regex patterns
    supplier = re.search(r'(?:Emisor|Proveedor|Empresa):\\s*(.+)', text)
    invoice_num = re.search(r'(?:Factura|Nº)\\s*[:#]?\\s*(\\w+-?\\d+)', text)
    date = re.search(r'(\\d{1,2}[/\\-]\\d{1,2}[/\\-]\\d{2,4})', text)
    base = re.search(r'Base\\s+imponible[:\\s]+(\\d+[.,]\\d{2})', text)
    vat = re.search(r'IVA\\s+(\\d+)%', text)

    base_amount = float(base.group(1).replace(',', '.')) if base else 0.0
    vat_rate = float(vat.group(1)) / 100 if vat else 0.21
    vat_amount = base_amount * vat_rate

    return InvoiceData(
        supplier=supplier.group(1).strip() if supplier else "Desconocido",
        invoice_number=invoice_num.group(1) if invoice_num else "",
        date=date.group(1) if date else "",
        base_amount=base_amount,
        vat_rate=vat_rate,
        vat_amount=vat_amount,
        total=base_amount + vat_amount
    )`,
  results: {
    es: `El resultado fue inmediato. El proceso que antes llevaba 10 horas ahora se ejecuta en menos de 5 minutos. El gestor recibe directamente el Excel con todos los datos validados y listos para presentar.

**Impacto medido:**
- 10 horas ahorradas por trimestre = 40 horas/año
- 0 errores de transcripción en el último trimestre
- 167 facturas procesadas automáticamente cada trimestre
- El Excel llega al gestor el mismo día que se reciben las facturas`,
    en: `The result was immediate. The process that used to take 10 hours now runs in less than 5 minutes. The accountant directly receives the Excel with all validated data ready to file.

**Measured impact:**
- 10 hours saved per quarter = 40 hours/year
- 0 transcription errors in the last quarter
- 167 invoices processed automatically each quarter
- The Excel reaches the accountant the same day invoices are received`,
  },
}
