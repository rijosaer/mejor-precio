// Escáner de código de barras. Usa el detector del navegador (Chrome en
// Android lo trae); donde no existe (iPhone, Firefox) carga ZXing desde
// vendor/ la primera vez que se abre la cámara.
import { $, acciones } from './util.js';

const FORMATOS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];
let escaneo = null;
let zxing = null;

function cargarZxing() {
  zxing ||= new Promise((resolver, rechazar) => {
    if (window.ZXing) return resolver(window.ZXing);
    const s = document.createElement('script');
    s.src = 'vendor/zxing-0.21.3.min.js';
    s.onload = () => (window.ZXing ? resolver(window.ZXing) : rechazar(new Error('ZXing no cargó')));
    s.onerror = () => {
      zxing = null;
      rechazar(new Error('No se pudo cargar el lector'));
    };
    document.head.append(s);
  });
  return zxing;
}

// Devuelve una función que mira un cuadro del video y responde el código o null.
async function crearDetector(video) {
  if ('BarcodeDetector' in window) {
    try {
      const soportados = await BarcodeDetector.getSupportedFormats();
      const formatos = FORMATOS.filter((f) => soportados.includes(f));
      if (formatos.length) {
        const detector = new BarcodeDetector({ formats: formatos });
        return async () => (await detector.detect(video))[0]?.rawValue || null;
      }
    } catch {
      /* se usa ZXing */
    }
  }
  const Z = await cargarZxing();
  const lector = new Z.MultiFormatReader();
  const pistas = new Map();
  pistas.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.UPC_E]);
  pistas.set(Z.DecodeHintType.TRY_HARDER, true);
  lector.setHints(pistas);
  const lienzo = document.createElement('canvas');
  return async () => {
    if (!video.videoWidth) return null;
    // Se lee la franja del centro (donde está el marco): más rápido y más preciso.
    const ancho = Math.min(960, video.videoWidth);
    const escala = ancho / video.videoWidth;
    lienzo.width = ancho;
    lienzo.height = Math.round(video.videoHeight * escala * 0.5);
    const ctx = lienzo.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, video.videoHeight * 0.25, video.videoWidth, video.videoHeight * 0.5, 0, 0, lienzo.width, lienzo.height);
    try {
      const fuente = new Z.HTMLCanvasElementLuminanceSource(lienzo);
      return lector.decodeWithState(new Z.BinaryBitmap(new Z.HybridBinarizer(fuente))).getText();
    } catch {
      return null; // no hay código en este cuadro
    }
  };
}

async function abrirEscaner() {
  const video = $('#escaner-video');
  const texto = $('#escaner-texto');
  texto.textContent = 'Apunta al código de barras de la botella';
  $('#escaner').hidden = false;
  try {
    const flujo = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    escaneo = { flujo, activo: true };
    video.srcObject = flujo;
    await video.play();
  } catch {
    texto.textContent = 'No se pudo abrir la cámara. Revisa el permiso o escribe el código.';
    return;
  }
  let detectar;
  try {
    detectar = await crearDetector(video);
  } catch (error) {
    texto.textContent = `${error.message}. Escribe el código a mano.`;
    return;
  }
  const mirar = async () => {
    if (!escaneo?.activo) return;
    let codigo = null;
    try {
      codigo = await detectar();
    } catch {
      /* cuadro sin imagen todavía */
    }
    if (codigo && /^\d{8,14}$/.test(codigo)) {
      cerrarEscaner();
      if (navigator.vibrate) navigator.vibrate(40);
      acciones.mostrar('buscar');
      acciones.buscar(codigo);
      return;
    }
    setTimeout(mirar, 200);
  };
  mirar();
}

function cerrarEscaner() {
  if (escaneo) {
    escaneo.activo = false;
    escaneo.flujo.getTracks().forEach((t) => t.stop());
    escaneo = null;
  }
  $('#escaner-video').srcObject = null;
  $('#escaner').hidden = true;
}

export function configurarEscaner() {
  // Con cámara basta: si el navegador no trae detector, se usa ZXing.
  if (navigator.mediaDevices?.getUserMedia) {
    $('#escanear').hidden = false;
    $('#escanear').addEventListener('click', abrirEscaner);
  }
  $('#escaner-cerrar').addEventListener('click', cerrarEscaner);
}
