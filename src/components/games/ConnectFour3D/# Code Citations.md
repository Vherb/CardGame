# Code Citations

## License: MIT
https://github.com/albertyw/dotfiles/tree/a995bdd285629f180b8a13757f7139b68a50603b/scripts/git/size

```
--objects --all \
  | git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' \
  | sed -n 's/^blob //p' \
  | awk '$
```

