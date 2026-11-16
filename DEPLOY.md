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
- Le certificat est obtenu automatiquement par Caddy dès que le DNS pointe vers le serveur (ne servir **qu'en HTTPS**).

## 3. Serveur web (Caddy)

Le serveur utilise déjà Caddy, qui obtient et renouvelle seul le certificat HTTPS. Copier `dist` dans `/var/www/planification`, puis ajouter à `/etc/caddy/Caddyfile` le bloc de [deploy/Caddyfile.planification](deploy/Caddyfile.planification) (en-têtes de sécurité, politique CSP, cache) et recharger :

```bash
sudo cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak-$(date +%Y%m%d-%H%M%S)
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

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

- **Compagnon et navigateurs** : le site est en ligne sur `https://planification.potodugoud.fr` et le calcul dans la page y fonctionne. Le compagnon répond correctement (origine, contrôle préalable « réseau privé »), mais le navigateur intégré de l'outil de développement bloque l'accès d'une page HTTPS à `http://127.0.0.1` ; cela n'a donc pas pu être vérifié de bout en bout. À essayer dans Chrome/Edge ; Safari peut bloquer ce contenu mixte.
- **Avertissement Windows** : le lanceur `.cmd` n'est pas signé ; Windows peut afficher un avertissement au premier lancement (expliqué dans la page).
- **Pas de mises à jour automatiques** du compagnon : si le protocole change, la page ne le détectera plus et l'utilisateur devra retélécharger l'archive.
- **HiGHS natif** : jamais essayé avec un vrai exécutable (voir `packages/companion/README.md`).

## État du déploiement (16 novembre 2026)

- Serveur : Ubuntu, Caddy 2.6.2 (déjà utilisé pour `musique` et `jeux`), fichiers dans `/var/www/planification`.
- Mise à jour du site : `npm run build:site`, puis `tar -cf - -C packages/app/dist . | ssh ubuntu@<serveur> 'sudo tar -xf - --no-same-owner -C /var/www/planification'`. Pas de rechargement de Caddy nécessaire.
- Sauvegardes de la configuration : `/etc/caddy/Caddyfile.bak-*`.
