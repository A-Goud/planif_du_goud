# Pile technique et étapes de réalisation

Complète [DESCRIPTION.md](DESCRIPTION.md). Les choix ci-dessous sont des **propositions** à valider.

## 1. Pile technique proposée

| Domaine | Choix | Raison |
|---|---|---|
| Langage | **TypeScript** partout (application, compagnon) | Un seul langage, types stricts pour un modèle de données riche. |
| Application | **Vite** + un framework d'interface (**React** proposé) | Application statique, servie par le site, rien côté serveur. |
| Calcul | **Web Worker** | Le solveur ne bloque pas l'interface et peut être annulé. |
| Solveur navigateur | **HiGHS** en WebAssembly | Voir DESCRIPTION.md §8. |
| Solveur compagnon | **HiGHS natif** (binaire), piloté par un petit programme **Node.js** | Plus de mémoire et de puissance que le WebAssembly. Même moteur, donc résultats comparables. |
| Données | Fichier **JSON versionné**, validé avec un schéma (par exemple Zod) | Validation à l'import (DESCRIPTION.md §9). |
| Sauvegarde automatique | **IndexedDB** dans le navigateur, en plus du fichier | Évite de perdre le travail ; le fichier reste la sauvegarde de référence. |
| Temps | Entiers en **unités de 15 minutes** à l'intérieur, dates au format ISO à l'affichage | Évite les erreurs de fuseau et d'arrondi. |
| Tests | **Vitest** + jeux de données d'exemple (mairie fictive, asso de basket) | Les contraintes se testent sur des cas connus. |
| Hébergement | Site statique sur le sous-domaine, installateur du compagnon généré à la volée | Comme dans le document de distribution. |

**Séparation du code** (trois paquets) :
- `core` : modèle de données, validation, règles de calendrier. Aucune dépendance au navigateur.
- `solver` : transforme un problème en modèle d'optimisation, appelle HiGHS, interprète le résultat. Même code dans le navigateur et le compagnon.
- `app` : interface. `companion` : programme local.

## 2. Étapes

Chaque étape se termine par quelque chose qu'on peut essayer.

**Étape 0 : prototype du solveur (risque principal).**
Une semaine type, quelques salles, quelques demandes, grille de 15 min, HiGHS en WebAssembly. Objectif : mesurer la taille atteignable et confirmer le choix de HiGHS. *Si les performances sont insuffisantes, on réexamine le moteur avant d'aller plus loin.*

**Étape 1 : modèle de données et fichiers.**
Ressources, demandeurs, demandes, périodes. Export et import JSON avec validation et numéro de version.

**Étape 2 : modèle d'optimisation complet.**
Contraintes dures (chevauchement, capacité, types, disponibilités, groupes compatibles), demandes souples avec priorités et minimums, objectifs ordonnés.

**Étape 3 : interface de saisie et de visualisation.**
Formulaires pour ressources et demandes, vue du planning par salle et par demandeur, lancement du calcul.

**Étape 4 : verrouillage, blocage, stabilité.**
Créneaux verrouillés et bloqués, résolution partielle, trois modes de stabilité, référence de l'année précédente.

**Étape 5 : diagnostic et suggestions.**
Raison des refus, relances automatiques en relâchant une contrainte à la fois.

**Étape 6 : calendrier daté.**
Périodes, cycles de 1 ou 2 semaines, fermetures, exceptions datées, projection sur les dates.

**Étape 7 : coachs.**
Disponibilités individuelles, un coach à un seul endroit à la fois.

**Étape 8 : délégation.**
Export des créneaux d'une association vers un fichier, import comme ressources d'un nouvel espace.

**Étape 9 : compagnon.**
Programme local, solveur natif, installateur généré, détection depuis la page, recommandation selon la taille du problème.

**Étape 10 : mise en ligne.**
Sous-domaine, HTTPS, documentation des limites dans la page (avertissement Windows, programme à laisser ouvert).

## 3. Ordre et dépendances

L'étape 0 conditionne toutes les autres. Les étapes 1 à 3 donnent un premier logiciel utilisable pour un cas simple ; 4 à 7 le rendent complet ; 8 à 10 le rendent distribuable. Les étapes 6 et 7 pourraient être permutées sans conséquence.

## 4. Points à valider

1. React comme framework d'interface (à défaut, Svelte ou Vue).
2. Compagnon en Node.js plutôt qu'un exécutable autonome (Node.js suit le document de distribution ; un exécutable évite d'installer Node).
3. Commencer par l'étape 0 avant toute interface.
