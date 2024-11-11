# TODO List - Améliorations `MessageStore` et `IdempotencyStore`

## Objectif Général
Améliorer la gestion des messages non routés et des vérifications d’idempotence en introduisant des services de persistance pour le `MessageStore` et l’`IdempotencyStore`. Cela assurera une gestion robuste des messages, même en cas d'échec ou de redémarrage de services, tout en facilitant la scalabilité et la centralisation des données pour les applications futures.

## Étapes à Suivre

### 1. Transformer `MessageStore` en Service de Persistance

   - **Objectif** : Permettre au `MessageStore` de stocker les messages non routés de manière persistante pour garantir la rediffusion des messages lors de la reconnexion des services.
   - **Détails** :
     - **Création d’un microservice `MessageStore`** :  
       - **API RESTful** (ou gRPC si requis) pour les opérations suivantes :
         - `POST /messages` : Ajouter un message non routé.
         - `GET /messages` : Récupérer tous les messages non routés.
         - `DELETE /messages/{messageId}` : Supprimer un message une fois rediffusé.
       - **Base de données** : Utiliser une base de données compatible avec une persistance durable, comme MongoDB ou Redis, pour la gestion de ces messages.
       - **Stockage structuré** : Chaque message doit inclure :
         - Un `messageId` unique.
         - `routingKey` : La clé de routage du message.
         - `content` : Le contenu du message.
         - `options` : Les options du message.
         - `timestamp` : La date de stockage du message.
     - **Gestion des expirations** :
       - Ajouter une politique de suppression automatique pour les messages trop anciens.
       - Configurer un paramètre `TTL` dans la base de données pour supprimer les messages expirés après une durée définie (ex. : 24 heures).

   - **Implémentation dans `EventBus`** :
     - Intégrer des appels API à ce microservice dans `EventBus` pour `add`, `getAll`, et `clear` les messages non routés.
     - Implémenter une logique de rediffusion automatique au démarrage de `EventBus` en récupérant les messages du `MessageStore` pour les republier.

### 2. Transformer `IdempotencyStore` en Service de Persistance

   - **Objectif** : Centraliser les vérifications d’idempotence pour éviter les traitements en double, même si plusieurs instances de `EventBus` existent.
   - **Détails** :
     - **Création d’un microservice `IdempotencyStore`** :
       - **API RESTful** pour les opérations :
         - `POST /idempotency` : Marquer un message comme traité.
         - `GET /idempotency/{messageId}` : Vérifier si un message a déjà été traité.
         - `DELETE /idempotency/{messageId}` : Supprimer l’idempotence d’un message après un certain temps.
       - **Base de données** : Stocker les vérifications d’idempotence dans une base de données rapide, comme Redis ou MongoDB, en utilisant une clé unique par `messageId`.
       - **Données stockées** : Inclure le `messageId`, un `timestamp` de traitement et un éventuel `result` de la transaction, si applicable.
       - **Expiration automatique** : Configurer un TTL pour expirer automatiquement les vérifications d’idempotence.

   - **Implémentation dans `EventBus`** :
     - Adapter `EventBus` pour effectuer des appels API à `IdempotencyStore` lors de la vérification et de la mise à jour des messages traités.
     - Remplacer les appels locaux par des appels API, pour s'assurer qu'une seule source de vérité est utilisée pour l'idempotence dans un environnement distribué.

### 3. Mise à Jour du `EventBus` pour la Persistance Externe

   - **Paramétrage** :
     - Introduire des options de configuration dans `EventBus` pour choisir entre une persistance locale (en utilisant les versions actuelles de `MessageStore` et `IdempotencyStore`) et une persistance externe via des microservices.
   - **Ajout de Logique de Fallback** :
     - Si les services de persistance externes sont inaccessibles, `EventBus` doit pouvoir basculer vers un stockage en mémoire locale temporaire pour garantir la résilience.
   - **Documentation** :
     - Documenter l’usage des microservices pour `MessageStore` et `IdempotencyStore`, y compris les détails de configuration et les prérequis de déploiement pour les utilisateurs finaux.

### 4. Tests et Validation

   - **Tests unitaires** :
     - Tester toutes les méthodes intégrant les appels API à `MessageStore` et `IdempotencyStore`.
     - Vérifier la rediffusion des messages et la logique d’idempotence.
   - **Tests d'intégration** :
     - Déployer les microservices en environnement de test et valider l’interaction avec `EventBus`.
   - **Surveillance et Logs** :
     - Ajouter des logs détaillés dans `EventBus` pour les tentatives de rediffusion et les vérifications d’idempotence afin de faciliter le débogage en production.
     - Envisager l’ajout d’une supervision pour les microservices `MessageStore` et `IdempotencyStore` pour anticiper les pannes.

### 5. Documentation

   - **Documentation d’installation et de configuration** :
     - Fournir des instructions pour le déploiement des microservices `MessageStore` et `IdempotencyStore`.
     - Expliquer les configurations disponibles dans `EventBus` pour activer ou désactiver la persistance externe.
   - **Exemples d’usage** :
     - Inclure des exemples de code dans la documentation pour illustrer l’utilisation de l’EventBus avec et sans persistance externe.
  
### 6. Planification du Déploiement

   - **Déploiement des microservices** :
     - Planifier le déploiement de `MessageStore` et `IdempotencyStore` en production en tenant compte de la charge anticipée.
   - **Migration progressive** :
     - Envisager une transition progressive pour les services existants en activant d’abord la persistance en mémoire, puis en basculant vers les microservices externes après validation.