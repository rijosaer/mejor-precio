// Uso: npm run claves-push
// Crea el par de claves VAPID para las notificaciones push. Pon las dos en las
// variables del servidor (VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY) y, si quieres,
// VAPID_SUBJECT con un correo de contacto (mailto:tu@correo.com).
import webpush from 'web-push';

const { publicKey, privateKey } = webpush.generateVAPIDKeys();
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log('VAPID_SUBJECT=mailto:tu-correo@ejemplo.com');
