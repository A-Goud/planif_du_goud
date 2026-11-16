# Mise en ligne

Le site est **statique** : l'application (HTML, JavaScript, WebAssembly) et l'archive du compagnon. Aucune donnée utilisateur n'y transite.

Adresse prévue : `https://planification.potodugoud.fr` (un **sous-domaine** plutôt qu'un chemin `potodugoud.fr/planification` : chaque sous-domaine est une « origine » distincte, donc le stockage du navigateur de l'application est isolé du reste du site, et le compagnon n'autorise qu'une origine précise).

## 1. Construire

```bash
npm install
npm run build:site
```

Produit `packages/app/dist/` : c'est tout ce qu'il faut publier. Il contient `index.html`, `assets/` (dont `highs-*.wasm`, le moteur de calcul) et `compagnon.zip`.

## 2. DNS et HTTPS

- Créer l'enregistrement DNS `planification` (A/AAAA vers le serveur, ou CNAME).
- Obtenir un certificat pour `planification.potodugoud.fr` (par exemple Let's Encrypt) et ne servir **qu'en HTTPS**.

## 3. Serveur web (exemple nginx)

```nginx
server {
  listen 443 ssl http2;
  server_name planification.potodugoud.fr;
  # ssl_certificate / ssl_certificate_key : selon votre outil (certbot, etc.)

  root /var/www/planification;   # contenu de packages/app/dist
  index index.html;

  types { application/wasm wasm; }   # en plus des types habituels (include mime.types;)

  add_header Strict-Transport-Security "max-age=31536000" always;
  add_header X-Content-Type-Options "nosniff" always;
  add_header Referrer-Policy "no-referrer" always;
  # connect-src : le compagnon local ; 'wasm-unsafe-eval' : moteur de calcul WebAssembly
  add_header Content-Security-Policy "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; worker-src 'self'; connect-src 'self' http://127.0.0.1:47821; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" always;

  location = /index.html { add_header Cache-Control "no-cache"; }
  location /assets/      { add_header Cache-Control "public, max-age=31536000, immutable"; }
}
```

Les `add_header` d'un bloc `location` remplacent ceux du serveur : si vous gardez des en-têtes de sécurité, répétez-les dans chaque `location` qui ajoute un `Cache-Control`.

Cette politique (CSP) a été testée sur le site construit : le calcul dans le navigateur et via le compagnon fonctionnent, sans erreur dans la console.

## 4. Compagnon

L'utilisateur télécharge `compagnon.zip` depuis la page (aide « Qu'est-ce que le compagnon ? »), le décompresse et lance le lanceur généré par la page, qui exécute :

```
node companion.mjs --origin https://planification.potodugoud.fr
```

Le compagnon n'écoute que `127.0.0.1:47821` et n'accepte que cette origine.

## 5. À vérifier après la mise en ligne

1. La page s'ouvre en HTTPS, « Charger l'exemple » puis « Calculer le planning » donne « Planning optimal ».
2. Console du navigateur sans erreur (en particulier de politique de sécurité).
3. `compagnon.zip` se télécharge ; une fois décompressé et lancé, « Rechercher le compagnon » le détecte et un calcul passe par lui.
4. Rechargement de la page : les données sont conservées (stockage du navigateur) ; l'onglet « À propos » est lisible.

## Limites connues

- **Compagnon et navigateurs** : testé uniquement avec le navigateur intégré à l'outil de développement, sur `http://` local. Chrome et Edge autorisent en principe une page HTTPS à joindre `http://127.0.0.1`, mais cela n'a pas été vérifié depuis le site réel ; Safari peut bloquer ce contenu mixte.
- **Avertissement Windows** : le lanceur `.cmd` n'est pas signé ; Windows peut afficher un avertissement au premier lancement (expliqué dans la page).
- **Pas de mises à jour automatiques** du compagnon : si le protocole change, la page ne le détectera plus et l'utilisateur devra retélécharger l'archive.
- **HiGHS natif** : jamais essayé avec un vrai exécutable (voir `packages/companion/README.md`).
