// api/mot-de-passe-oublie.js — alias de forgot-password.js
// auth.html appelle /api/mot-de-passe-oublie : ce fichier évite l'erreur 404
module.exports = require('./forgot-password');
