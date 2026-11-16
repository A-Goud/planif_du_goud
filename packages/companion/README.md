# Compagnon de calcul

Petit serveur local (Node.js) qui résout les modèles d'optimisation à la place du navigateur.

```
npm run build -w @planif/companion          # produit packages/companion/dist
node dist/companion.mjs --origin https://<le site>   # --dev pour http://localhost:5173
```

- Écoute uniquement `127.0.0.1` (port 47821 par défaut) ; refuse tout `Host` non local et toute `Origin` hors liste blanche.
- Moteur : exécutable HiGHS natif s'il est trouvé (`--highs <chemin>` ou `highs` dans le PATH), sinon HiGHS WebAssembly dans un processus séparé.
- Un seul calcul à la fois ; annuler dans le navigateur arrête le calcul.
- `npm run build:exe -w @planif/companion` produit `compagnon.exe` (Node + programme + HiGHS, ~95 Mo, Windows) dans `packages/app/public/`. Sans option, il autorise `https://planification.potodugoud.fr`. Le calcul tourne dans un second processus (le même exécutable relancé avec `--solve-child`) ; annuler dans le navigateur le tue. L'exécutable n'est pas signé (avertissement SmartScreen).
- `dist/` est autonome : copier le dossier entier (il contient `node_modules/highs`).

Le chemin HiGHS natif n'a pas été essayé avec un vrai exécutable : seule la lecture de son fichier de solution est testée.
