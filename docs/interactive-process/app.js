import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';

const details = {
  entry: ['Entrada de solicitud', 'Se conserva el origen de la solicitud mediante source_type, source_reference y source_metadata.'],
  client: ['Cliente y solicitud', 'Se crea o identifica el cliente y se registra la solicitud de importación o exportación.'],
  received: ['Estado received', 'Las solicitudes exentas de pago pueden pasar directamente a revisión.'],
  review: ['Estado under_review', 'El equipo revisa los datos y determina los siguientes pasos operativos.'],
  awaiting: ['Estado awaiting_payment', 'La solicitud requiere pago y permanece pendiente hasta una confirmación válida.'],
  wompi: ['Referencia Wompi', 'Se crea una referencia única con el monto y la política de pago aplicable.'],
  checkout: ['Pago del cliente', 'El cliente completa el pago en Wompi.'],
  webhook: ['Webhook Wompi', 'La plataforma valida firma e idempotencia antes de procesar el resultado.'],
  rejected: ['Pago rechazado', 'Se registra el evento, se actualiza payment_status y se envían los correos configurados.'],
  approved: ['Pago aprobado', 'Se actualiza payment_status y la solicitud; después solo se notifican los implicados.'],
  operations: ['Seguimiento operativo', 'La asignación, revisión y avance posterior quedan bajo control del equipo desde el panel.'],
  information: ['Información adicional', 'El equipo decide si necesita datos o documentos antes de continuar.'],
  'more-info': ['Información requerida', 'Se solicita al cliente la información faltante y se conserva la trazabilidad.'],
  progress: ['Estado in_progress', 'La solicitud entra en ejecución con tareas, documentos y comentarios.'],
  completed: ['Solicitud completada', 'Se registra el cierre, se envían notificaciones y se audita la operación.'],
};

const sourceSelect = document.querySelector('#sourceSelect');
const sourceNodes = [...document.querySelectorAll('[data-source]')];
const paymentButtons = [...document.querySelectorAll('[data-payment]')];
const branches = [...document.querySelectorAll('[data-branch]')];
const detailTitle = document.querySelector('#detailTitle');
const detailText = document.querySelector('#detailText');
const detailStatus = document.querySelector('#detailStatus');
const policyBadge = document.querySelector('#policyBadge');
const policyDescription = document.querySelector('#policyDescription');

let paymentPolicy = 'required';

mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'loose',
  theme: 'base',
  themeVariables: {
    primaryColor: '#e7f0f7',
    primaryTextColor: '#16243a',
    primaryBorderColor: '#7ba7e8',
    lineColor: '#6b7b91',
    secondaryColor: '#e0f5ee',
    tertiaryColor: '#fff1d5',
    fontFamily: 'Inter, system-ui, sans-serif',
  },
});

async function renderMermaid() {
  const paymentFlow = paymentPolicy === 'required'
    ? `R --> S[Estado: awaiting_payment]\n    S --> T[Referencia Wompi]\n    T --> U[Cliente paga]\n    U --> V[Webhook Wompi]\n    V --> W{Pago aprobado?}\n    W -->|No| X[Registrar rechazo y notificar]\n    W -->|Sí| Y[Actualizar payment_status]\n    Y --> Z[Enviar correos configurados]\n    Z --> AA[Seguimiento operativo]`
    : `R --> AA[Estado: received]\n    AA --> AB[Enviar correos configurados]\n    AB --> AC[Seguimiento operativo]`;

  const source = `flowchart TD\n    A[${sourceSelect.options[sourceSelect.selectedIndex].text}] --> B[Entrada de solicitud]\n    B --> C[Crear cliente y solicitud]\n    C --> D{¿Requiere pago?}\n    D -->|Sí| R[Política de pago]\n    D -->|No| N[Solicitud exenta]\n    N --> O[Actualizar request_status]\n    O --> P[Enviar correos configurados]\n    P --> AA[Seguimiento operativo]\n    ${paymentFlow}\n    AA --> AB2{¿Falta información?}\n    AB2 -->|Sí| AC2[Solicitar datos o documentos]\n    AC2 --> AA\n    AB2 -->|No| AD[in_progress]\n    AD --> AE[completed y auditar]\n    classDef source fill:#e4f0ff,stroke:#5793df,color:#16243a,stroke-width:2px\n    classDef action fill:#ffffff,stroke:#afbdd0,color:#16243a,stroke-width:2px\n    classDef decision fill:#fff1d5,stroke:#e0a437,color:#6f4a00,stroke-width:2px\n    classDef success fill:#e0f5ee,stroke:#56b99e,color:#125d4d,stroke-width:2px\n    classDef info fill:#e4f0ff,stroke:#7ba7e8,color:#164f81,stroke-width:2px\n    class A source\n    class B,C,R,O,P,S,T,V,W,AB,AB2,AC2 action\n    class D,W,AB2 decision\n    class N,AA,AD,AE,Y,Z,AC success\n    class U,T info`;

  const target = document.querySelector('#mermaidDiagram');
  const { svg } = await mermaid.render(`requestFlow${Date.now()}`, source);
  target.innerHTML = svg;
}

function updateSource() {
  const source = sourceSelect.value;
  sourceNodes.forEach((node) => node.classList.toggle('is-selected', node.dataset.source === source));
  detailStatus.textContent = `source_type: ${source}`;
  renderMermaid();
}

function updatePolicy() {
  paymentButtons.forEach((button) => button.classList.toggle('is-active', button.dataset.payment === paymentPolicy));
  branches.forEach((branch) => branch.classList.toggle('is-muted', branch.dataset.branch !== paymentPolicy));
  const required = paymentPolicy === 'required';
  policyBadge.textContent = required ? 'Pago requerido' : 'Exenta de pago';
  policyBadge.className = `badge ${required ? 'badge-payment' : ''}`;
  policyDescription.textContent = required
    ? 'La solicitud espera confirmación válida de Wompi.'
    : 'La solicitud pasa directamente a revisión operativa.';
  renderMermaid();
}

function showDetail(key) {
  const [title, text] = details[key] || details.entry;
  detailTitle.textContent = title;
  detailText.textContent = text;
}

sourceSelect.addEventListener('change', updateSource);
paymentButtons.forEach((button) => button.addEventListener('click', () => {
  paymentPolicy = button.dataset.payment;
  updatePolicy();
}));
document.querySelectorAll('[data-detail]').forEach((node) => node.addEventListener('click', () => showDetail(node.dataset.detail)));
sourceNodes.forEach((node) => node.addEventListener('click', () => {
  sourceSelect.value = node.dataset.source;
  updateSource();
}));

updateSource();
updatePolicy();
