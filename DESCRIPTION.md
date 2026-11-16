# La planif d'Alix : planification sous contraintes

Adresse prévue : sous-domaine de potodugoud.fr (voir §10).

## 1. Objectif

Un logiciel d'**optimisation sous contraintes** qui répartit des **ressources** (par exemple les salles d'une municipalité) entre des **demandeurs** (par exemple des associations) sur une période (l'année).

Ce n'est **pas** un logiciel de réservation : l'utilisateur ne choisit pas les créneaux un par un. Il décrit les ressources et les besoins, et le logiciel **calcule** un planning qui respecte les contraintes et optimise des critères (satisfaction, stabilité, équité).

## 2. Principe de délégation (cœur du modèle)

Le logiciel est **générique et récursif** : le résultat d'un niveau devient l'entrée du niveau suivant.

```
Mairie  : salles          + demandes des associations     -> planning mairie
Asso    : créneaux reçus  + demandes des sections/coachs  -> planning de l'asso
```

- Au niveau « mairie », les ressources sont des **salles**. Au niveau « association », les ressources sont les **créneaux obtenus** (dans telle salle, tel jour, telle heure).
- Un même logiciel sert donc aux deux niveaux. Aucune notion « mairie » n'est codée en dur : on parle de **ressources**, de **demandes** et de **planning**.
- Chaque niveau est autonome : l'association n'a pas besoin de voir le planning des autres.

## 3. Utilisateurs

| Rôle | Fait quoi |
|---|---|
| Agent de la mairie | Saisit les salles et les demandes (reçues hors logiciel), lance le calcul, ajuste, exporte. |
| Responsable d'association | Importe les créneaux fournis par la mairie, saisit les demandes de ses sections et les disponibilités des coachs, lance le calcul. |

Les demandes **ne transitent pas par le logiciel** : c'est l'utilisateur qui les saisit. Pas de comptes, pas de collaboration en ligne.

## 4. Modèle de données

### Ressource (salle)
- Capacité maximale (nombre de personnes).
- Types d'activité acceptés (basket, réunion, danse…).
- **Combinaisons d'activités** pouvant avoir lieu en même temps (partage de la salle), saisies par l'agent salle par salle. Exemple : basket + escalade, basket + ping-pong, ping-pong + escalade + badminton. Une activité seule est toujours permise si son type est accepté.
- Jours et horaires de disponibilité (récurrence hebdomadaire, fermetures et exceptions).

### Demande (association, section)
- Nombre de créneaux souhaités, durée, récurrence (par exemple hebdomadaire).
- Type d'activité et effectif.
- Exigence de lieu : une **salle précise ou d'un type précis** (terrain de basket), ou **n'importe quelle salle**.
- Partageable ou non avec d'autres demandeurs.
- Préférences éventuelles (jours, horaires).
- **Priorité**, saisie à la main par l'agent (valeur par défaut proposée).
- **Minimum acceptable** (par exemple 1 créneau sur 2 demandés).
- **Alternatives acceptées** (autre salle, autre horaire, durée réduite).

Une même association peut avoir des demandes de natures différentes (un créneau de basket exigeant un terrain, une réunion hebdomadaire acceptant n'importe quelle salle).

### Temps
- **Grille de 15 minutes** : tout début et toute durée sont des multiples de 15 min. Les créneaux sont de **durée libre** (par exemple 1 h 15).
- **Calendrier daté** : la période est une plage de dates réelles (année scolaire ou civile). Elle comporte des **fermetures** (jours fériés, vacances, fermetures de salle) et des **événements ponctuels**.
- **Périodes** : l'année est découpée en **périodes** (environ 6 semaines, typiquement délimitées par les vacances). Chaque période est résolue séparément : on y résout un **motif répété**, puis on le projette sur les dates. Les demandes et les disponibilités peuvent changer d'une période à l'autre.
- **Récurrence** : une demande est une règle de la forme « toutes les *k* semaines » (k = 1 ou 2 en pratique), par exemple « chaque mardi 18 h-19 h 30 » ou « un mardi sur deux ». Le motif résolu couvre donc **1 ou 2 semaines** (le plus petit commun multiple des cycles des demandes de la période). Des exceptions datées restent possibles (séance annulée ou déplacée).
- **Continuité entre périodes** : le planning d'une période sert de référence à la suivante, via l'objectif de stabilité (§5). Le changement de période n'est pas une rupture : sans modification de demande, on retrouve les mêmes créneaux.
- Les disponibilités des salles sont aussi des règles hebdomadaires plus des exceptions datées.

### Planning
Ensemble d'affectations (demande -> ressource, jour, heure), dont certaines sont **verrouillées**.

## 5. Contraintes et objectifs

**Dures** (toujours respectées) :
- pas de chevauchement dans une salle, sauf activités déclarées compatibles ;
- capacité de la salle ≥ effectif ;
- type d'activité autorisé dans la salle ;
- disponibilité de la salle (jours, horaires) ;
- créneaux verrouillés et créneaux bloqués par l'utilisateur.

**Demandes : souples.** Les demandes ne sont pas des contraintes dures. Le logiciel ne répond jamais « impossible » : il produit le meilleur planning possible et indique ce qu'il n'a pas pu accorder.

**Objectifs** (à optimiser, par ordre lexicographique) :
1. satisfaire les demandes de priorité haute (dont les minimums garantis) ;
2. satisfaire les autres demandes, avec équité entre demandeurs ;
3. **stabilité** : conserver les créneaux de l'année précédente ;
4. préférences de jours et d'horaires.

L'ordre est modifiable ; la stabilité en 3e position est un choix par défaut.

## 6. Fonctionnalités de calcul

- **Résolution globale** : le temps de calcul n'est pas critique. On calcule le planning de l'année, rarement.
- **Résolution partielle** : verrouiller une partie du planning, puis ajouter ou modifier une salle ou un demandeur sans tout recalculer.
- **Blocage manuel** de créneaux par l'utilisateur.
- **Planning impossible** : décidé. Les demandes sont souples avec priorités saisies à la main. Pour chaque demande non satisfaite, le logiciel donne :
  - un **diagnostic** : la raison (par exemple « aucune salle de basket libre, occupées par X et Y ») ;
  - des **suggestions testées automatiquement** : le solveur relance le calcul en relâchant une contrainte à la fois (durée réduite, autre salle, autre horaire) et indique ce qui débloquerait la demande. L'agent décide, rien n'est appliqué sans lui.
- **Échelle visée** : quelques dizaines de salles et quelques dizaines d'associations.

## 7. Données et sauvegarde

- **Tout est local** : aucune donnée utilisateur n'est stockée sur le serveur.
- Sauvegarde dans un **fichier** que l'utilisateur transfère comme il veut.
- Le fichier peut être **découpé par entité** : la mairie exporte à une association uniquement les créneaux qui la concernent (par exemple le fichier de l'asso de basket), que l'association importe comme ses ressources.
- Les données d'une année précédente sont réutilisables pour la stabilité.

## 8. Architecture (selon le document de distribution)

- **Site** : sert l'application et les fichiers. Rien d'autre (pas d'annuaire ni de signalisation a priori, puisqu'il n'y a pas de session partagée).
- **Navigateur** : interface, état, sauvegarde et export de fichiers.
- **Solveur** : **les deux**, derrière une même interface.
  - **Navigateur (WebAssembly)** pour les petits problèmes, sans installation.
  - **Compagnon local** optionnel (solveur natif) pour les gros problèmes, installé depuis le site selon le modèle du document de distribution.
  - Le modèle du problème est décrit dans un format indépendant du solveur (JSON) ; chaque solveur reçoit le même modèle et renvoie le même format de résultat. Si le compagnon est absent, l'application reste utilisable avec le solveur navigateur (dégradation douce).

## 9. Questions ouvertes

1. ~~Solveur~~ : tranché, navigateur pour les petits problèmes et compagnon local pour les gros (voir §8). **C'est l'utilisateur qui choisit** : le solveur navigateur est le **défaut**, et le logiciel **recommande** le compagnon quand la taille estimée du problème est grande. Moteur retenu en principe : **HiGHS** (existe en WebAssembly et en natif, donc résultats comparables), à confirmer par un prototype de performance.
2. ~~Planning impossible~~ : tranché (voir §5 et §6). Reste à définir la valeur par défaut des priorités et l'échelle des poids.
3. ~~Granularité du temps~~ : tranché, durées libres sur une grille de 15 min (voir §4).
4. ~~Période~~ : tranché, calendrier daté (voir §4).
   - Taille du problème : tranché. On résout par **périodes d'environ 6 semaines** sur un motif de 1 ou 2 semaines (672 ou 1 344 pas par salle), puis on projette sur les dates (voir §4).
   - **Découpage en périodes** : tranché. L'agent saisit les périodes ; le logiciel suggère des bornes à partir d'un calendrier de vacances.
   - **Partage dans le temps** : tranché. Deux demandes bimensuelles de demandeurs différents peuvent occuper le même créneau en alternance (semaines paires et impaires), grâce au motif de 2 semaines.
   - **Créneau identique entre périodes** : tranché. C'est **préféré** (objectif de stabilité, §5) et il doit être possible de l'**imposer** pour une demande donnée (contrainte dure : même salle, même horaire sur les périodes concernées).
5. ~~Partage~~ : tranché, l'agent saisit les combinaisons autorisées par salle (voir §4). Une combinaison autorise aussi **tous ses sous-ensembles** (ping-pong + escalade + badminton permet ping-pong + escalade). La capacité de la salle s'applique à l'**effectif cumulé** de toutes les activités présentes.
6. ~~Stabilité~~ : tranché, **réglable par l'utilisateur**. Trois modes : ignorée, souhaitée (poids dans l'objectif, par défaut) ou imposée (créneaux de la référence conservés sauf conflit). Possible globalement ou demande par demande.
7. ~~Coachs et sections~~ : tranché, **dans le périmètre de la version 1**. Disponibilités individuelles des coachs, et un coach ne peut être qu'à un seul endroit à la fois (nouvelle contrainte dure sur les personnes, au niveau association).
8. ~~Nom et vocabulaire~~ : tranché (voir §10).
9. ~~Sécurité des fichiers~~ : tranché. Pas de signature ni de chiffrement. Seule une **validation de format à l'import** est prévue (fichier lisible, numéro de version, champs cohérents), pour éviter qu'un fichier abîmé ou d'une autre version casse l'application.

## 10. Nom et vocabulaire

**Nom du logiciel** : « La planif d'Alix ».

**Glossaire** (termes du code, de la documentation et de l'interface) :

| Concept | Terme |
|---|---|
| Salle, terrain, coach | **Ressource** (avec un **type** : salle, coach…, affiché dans l'interface) |
| Association, section | **Demandeur** |
| Besoin d'un demandeur | **Demande** |
| Plage horaire attribuée | **Créneau** |
| Résultat du calcul | **Planning** |
| Tranche de l'année (~6 semaines) | **Période** |
| Motif répété de 1 ou 2 semaines | **Semaine type** (ou **cycle** pour 2 semaines) |
| Combinaison d'activités simultanées | **Groupe compatible** |
| Un niveau de travail (mairie, association) | **Espace** |
