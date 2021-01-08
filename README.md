# dnm-font-manager
Search system fonts with family and style using pure JavaScript, forked from rBurgett/system-font-families

### Installation
```
$ npm install dnm-font-manager
```

### Get all fonts
You can get more informations about fonts with `getFontsExtended()` and `getFontsExtendedSync()` rather than `getFonts()` and `getFontsSync()`
```
const SystemFonts = require('dnm-font-manager').default;

const systemFonts = new SystemFonts();

// asynchronous
systemFonts.getFonts()
  .then( res => {
    console.log(res)
  })
  .catch(err => console.log(err))

// synchronous
const fontList = systemFonts.getFontsSync();

```

### Find fonts with family and styles
```
var SystemFonts = require('dnm-font-manager').default;

const systemFonts = new SystemFonts();

cosnt search = [
    {
        family: "Source Sans Pro",
        style: ["Black", "Semibold Italic"]
    },
    {
        family: "Papyrus",
        style: "Regular"
    },
    {
      family: "Arial"
    }
]

// asynchronous
systemFonts.findFonts(search).then( res => {
    console.log(res);
}).catch(err => console.log(err))

// synchronous
const fontList = systemFonts.findFontsSync(search);

```
### Notice
This library will not throw an error if it finds a bad or incomplete font. It is designed to skip over any fonts which it has trouble reading.

### Work In Progress
Method to check if a font is installed, and install it if needed

### npm Scripts
Run the tests:
```
$ npm test
```
Re-compile the source code:
```
$ npm run build
```
Watch the `src` directory and automatically recompile on changes:
```
$ npm run watch
```
### Contributions
Contributions are welcome! If you have any issues and/or contributions you would like to make, feel free to file an issue and/or issue a pull request.

### License
Apache License Version 2.0

Copyright (c) 2016 by Ryan Burgett.
