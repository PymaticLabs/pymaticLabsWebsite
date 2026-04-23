export const caseStudy = {
  slug: 'estacion-servicio-castellon',
  title: 'De la operativa manual al piloto automático · Estación de servicio familiar',
  titleEn: 'From manual operations to autopilot · Family service station',
  location: 'Castellón, España',
  sector: 'Hostelería + Carburantes',
  sectorEn: 'Hospitality + Fuel',
  date: '2026-01',
  metrics: [
    { value: '~10h', label: 'ahorradas por semana', labelEn: 'saved per week' },
    { value: '4', label: 'automatizaciones activas', labelEn: 'active automations' },
    { value: '0', label: 'errores manuales en contabilidad', labelEn: 'manual accounting errors' },
  ],
  stack: ['Python', 'Gmail API', 'Claude API', 'n8n', 'openpyxl', 'Playwright'],
  challenge: {
    es: `Una pyme familiar con estación de servicio y bar dedicaba horas cada semana a tareas que se repetían sin parar: descargar facturas del correo una a una y renombrarlas, reformatear las exportaciones del TPV para que el gestor las entendiera, actualizar el diario mensual de caja y gestionar las tareas recurrentes de oficina.

Ninguna de estas tareas era complicada. Pero hacerlas bien, cada día, sin que nada se olvidara ni se copiara mal, consumía tiempo y atención constante. El problema no era la complejidad — era la acumulación.`,
    en: `A family-owned SMB with a service station and bar spent hours every week on tasks that repeated without end: downloading invoices from email one by one and renaming them, reformatting POS exports so the accountant could understand them, updating the monthly cash journal and managing recurring office tasks.

None of these tasks were complex. But doing them correctly, every day, without anything being forgotten or copied wrong, consumed constant time and attention. The problem wasn't complexity — it was accumulation.`,
  },
  solution: {
    es: `Desarrollamos cinco automatizaciones que cubren todo el ciclo operativo del negocio:

1. **Descarga y renombrado de facturas**: Un script conectado a la API de Gmail descarga automáticamente los PDFs de facturas entrantes y los renombra con un patrón coherente (fecha, tipo de gasto, proveedor). Cuando el formato del PDF es ambiguo, la Claude API interpreta el contenido para clasificarlo correctamente.

2. **Formateo del Excel del TPV**: Las exportaciones diarias del punto de venta se convierten automáticamente en un libro Excel estructurado con una pestaña por día, secciones claras y formato numérico correcto. El script es acumulativo: reprocesar un día solo sobreescribe esa pestaña.

3. **Actualización del diario mensual**: Los datos formateados del TPV se vuelcan automáticamente en el diario mensual del gestor, rellenando los 23 campos contables correspondientes en las columnas correctas. Si el diario del mes no existe, se crea desde plantilla.

4. **Gestor de tareas recurrentes**: Una aplicación de escritorio muestra cada mañana las tareas del día (diarias, semanales y mensuales), arrastra los pendientes automáticamente y no requiere conexión a internet ni cuentas externas.

4. **Gestor de tareas recurrentes**: Una aplicación de escritorio muestra cada mañana las tareas del día (diarias, semanales y mensuales), arrastra los pendientes automáticamente y no requiere conexión a internet ni cuentas externas.`,
    en: `We developed four automations covering the full operational cycle of the business:

1. **Invoice download and renaming**: A script connected to the Gmail API automatically downloads incoming invoice PDFs and renames them with a consistent pattern (date, expense type, supplier). When a PDF's format is ambiguous, the Claude API interprets the content to classify it correctly.

2. **POS Excel formatting**: Daily point-of-sale exports are automatically converted into a structured Excel workbook with one tab per day, clear sections and correct number formatting. The script is cumulative: reprocessing a day only overwrites that tab.

3. **Monthly journal update**: The formatted POS data is automatically written into the accountant's monthly journal, filling the 23 corresponding accounting fields in the correct columns. If the month's journal doesn't exist yet, it's created from a template.

4. **Recurring task manager**: A desktop application shows each morning's tasks (daily, weekly and monthly), automatically carries over pending items and requires no internet connection or external accounts.`,
  },
  codeSnippet: `# Invoice download and renaming — Gmail API
import re
from googleapiclient.discovery import build
from anthropic import Anthropic

client = Anthropic()

def classify_invoice(pdf_text: str, supplier_exceptions: dict) -> str:
    """Classify invoice as BAR or EESS using rules + AI fallback."""
    text_lower = pdf_text.lower()

    # Rule-based classification first
    for supplier, tag in supplier_exceptions.items():
        if supplier.lower() in text_lower:
            return tag

    bar_keywords = ['hostelería', 'alimentación', 'bebidas', 'makro']
    eess_keywords = ['combustible', 'carburante', 'gasoil', 'repsol', 'cepsa']

    if any(k in text_lower for k in bar_keywords):
        return 'BAR'
    if any(k in text_lower for k in eess_keywords):
        return 'EESS'

    # AI fallback for ambiguous cases
    response = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=10,
        messages=[{
            "role": "user",
            "content": f"Clasifica esta factura como BAR o EESS. Solo responde BAR o EESS.\\n\\n{pdf_text[:500]}"
        }]
    )
    result = response.content[0].text.strip().upper()
    return result if result in ('BAR', 'EESS') else 'EESS'

def build_filename(date: str, tag: str, supplier: str, total: float) -> str:
    mmdd = date.replace('/', '').replace('-', '')[:4]
    supplier_clean = re.sub(r'[^\\w]', '', supplier)[:20]
    return f"{mmdd}_{tag}_{supplier_clean}_{total:.2f}.pdf"`,
  results: {
    es: `El impacto fue inmediato y acumulativo. Cada automatización por separado ahorraba minutos; juntas liberan alrededor de 10 horas semanales de trabajo manual.

**Impacto medido:**
- ~10 horas/semana ahorradas en tareas operativas
- 0 errores manuales en el proceso contable desde la implantación
- Las facturas llegan al gestor ya organizadas y renombradas
- El diario mensual se actualiza solo, sin intervención humana
- Las tareas recurrentes de oficina se gestionan solas, sin depender de la memoria de nadie`,
    en: `The impact was immediate and cumulative. Each automation on its own saved minutes; together they free up around 10 hours of manual work per week.

**Measured impact:**
- ~10 hours/week saved on operational tasks
- 0 manual errors in the accounting process since implementation
- Invoices reach the accountant already organized and renamed
- The monthly journal updates itself, without human intervention
- Recurring office tasks run themselves, without depending on anyone's memory`,
  },
}
