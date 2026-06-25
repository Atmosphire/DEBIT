# Optimiseur de bruts

Petite application web pour optimiser le débit de bruts et limiter les chutes.

## Utilisation

1. Renseigner les **bruts disponibles** en millimètres.
2. Renseigner les **cotes à débiter** en millimètres.
3. Ajuster le **trait de scie** si besoin.
4. Cliquer sur **Optimiser le débit**.

Exemples acceptés :

```txt
6000
5000
6000 x 2
```

```txt
580
1200
450 x 4
```

## Mise en ligne sur GitHub Pages

1. Mettre tous les fichiers à la racine du dépôt GitHub.
2. Aller dans `Settings` > `Pages`.
3. Choisir `Deploy from a branch`.
4. Sélectionner la branche `main` et le dossier `/root`.
5. Ouvrir le lien généré sur le téléphone.

L’application fonctionne aussi comme une mini PWA : une fois ouverte sur le téléphone, elle peut être ajoutée à l’écran d’accueil.
