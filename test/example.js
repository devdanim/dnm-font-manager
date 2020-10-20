const fs = require('fs');
const SystemFonts = require('../dist/main').default;
const fontkit = require('fontkit');

const systemFonts = new SystemFonts({ debug: true, fontkit });
const request = [
    {family: 'Ballet Harmony', style: 'Ballet Harmony'},
    {family: 'Raleway', style: 'Light'}
];

systemFonts.findFonts(request).then( result => {
    console.log(result);
}).catch(e => console.error(e));

// console.log(systemFonts.findFontsSync(request));

// systemFonts.getFontsExtended().then(res => {
//     res.forEach(item => {
//         if(item.family.toLowerCase().indexOf('avenir') !== -1) {
//             console.log(item);
//         }
//     });
// });

// const dir = 'test/test-folder';
// fs.readdir(dir, (err, files) => {
//     const arr = files.map(file => dir + '/' + file);
//     console.log(arr);
//     systemFonts.installFonts(arr).then(res => console.log(res)).catch(e => console.error('ERR', e));
// });