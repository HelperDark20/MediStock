/* Redirige a los navegadores que no pueden ejecutar la app principal
   (p. ej. Safari de iOS 9–13.3) al panel de enfermero compatible.
   Escrito en ES5 a propósito: tiene que poder ejecutarse en esos navegadores.

   String.prototype.replaceAll llegó en las mismas versiones que la sintaxis
   ?. y ?? que usa la app (Safari 13.1, Chrome 85, Firefox 77), así que sirve
   para detectar si la app va a funcionar sin evaluar código (que la CSP
   del servidor bloquea). */
(function(){
  if(typeof String.prototype.replaceAll !== 'function'){
    window.location.replace('/enfermero');
  }
})();
