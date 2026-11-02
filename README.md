# Budget Courses

Appli web pour iPhone qui suit le budget pendant les courses. Elle fonctionne sans serveur :
la lecture des étiquettes et les données restent sur le téléphone.

## Essayer sur un ordinateur

```
python3 -m http.server 8000
```

Puis ouvrir http://localhost:8000.

## Mettre à jour une version en ligne

Augmenter `CACHE` dans `sw.js` à chaque modification, sinon les téléphones gardent l'ancienne version.
