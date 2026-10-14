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

function updateSource() {
  const source = sourceSelect.value;
  sourceNodes.forEach((node) => node.classList.toggle('is-selected', node.dataset.source === source));
  detailStatus.textContent = `source_type: ${source}`;
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
