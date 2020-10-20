import fs from 'fs';
import os from 'os';
import path from 'path';
import ttfInfo from 'ttfinfo';
import { spawn } from 'child_process';
import readChunk from 'read-chunk';
import getFileType from 'file-type';

const getPlatform = () => (process.platform === 'darwin') ? 'osx' : (/win/.test(process.platform) ? 'windows' : 'linux');

const recGetFile = (target) => {
    let stats;
    try {
        stats = fs.statSync(target);
    } catch (e) {
        return [];
    }
    if (stats.isDirectory()) {
        let files;
        try {
            files = fs.readdirSync(target);
        } catch (e) {
            console.error(e);
            return [];
        }
        return files
            .reduce((arr, f) => {
                if(f.toLowerCase() === 'deleted') return [];
                return arr.concat(recGetFile(path.join(target, f)));
            }, []);
    } else {
        const ext = path.extname(target).toLowerCase();
        if (ext === '.ttf' || ext === '.otf' || ext === '.ttc' || ext === '.dfont') {
            return [target];
        } else if (ext === '') {
            // NOTE: Check files without extension, TypeKit on Windows does that.
            const fontFileHeader = readChunk.sync(target, 0, getFileType.minimumBytes);
            const fileType = getFileType(fontFileHeader);
            if (!fileType) {
                return [];
            }

            if (fileType.ext === 'ttf' || fileType.ext === 'otf' || fileType.ext === 'ttc') {
                return [target];
            }

            return [];
        } else {
            return [];
        }
    }
};

const filterReadableFonts = arr => arr
    .filter(f => {
        const extension = path.extname(f).toLowerCase();
        if (extension === '.ttf' || extension === '.otf' || extension === '.ttc') {
            return true;
        }

        const fontFileHeader = readChunk.sync(f, 0, getFileType.minimumBytes);
        const fileType = getFileType(fontFileHeader);
        if (!fileType) {
            return false;
        }

        if (fileType.ext === 'ttf' || fileType.ext === 'otf') {
            return true;
        }

        return false;
    });

const filterFontTtfInfos = obj => {
    return {
        family: obj['16'] ? obj['16'] : obj['1'],
        subFamily: obj['17'] ? obj['17'] : obj['2'],
        postscript: obj['6'],
        alternativeFamilies: [],
        alternativeSubFamilies: []
    };
};

const ttfInfoTableToObj = (obj, file, systemFont) => {
    const infos = filterFontTtfInfos(obj);
    return {
        ...infos,
        file,
        systemFont
    };
};

const fontkitTableToObj = (obj, file, systemFont) => {
    const { familyName, subfamilyName, postscriptName, name } = obj;
    const alternativeFamilies = [];
    const alternativeSubFamilies = [];
    if(name && name.records) {
        const { preferredFamily, preferredSubfamily } = name.records;
        if(preferredFamily) {
            for(const key in preferredFamily) alternativeFamilies.push(preferredFamily[key]);
        }
        if(preferredSubfamily) {
            for(const key in preferredSubfamily) alternativeSubFamilies.push(preferredSubfamily[key]);
        }
    }
    const infos = {
        family: familyName,
        subFamily: subfamilyName,
        postscript: postscriptName,
        alternativeFamilies,
        alternativeSubFamilies
    };
    return {
        ...infos,
        file,
        systemFont
    };
};

const extendedReducer = (m, { family, subFamily, file, postscript, systemFont, alternativeFamilies, alternativeSubFamilies }) => {
    if (m.has(family)) {
        const origFont = m.get(family);
        return m.set(family, {
            ...origFont,
            systemFont: origFont.systemFont === false ? false : systemFont,
            subFamilies: [
                ...origFont.subFamilies,
                subFamily
            ],
            files: {
                ...origFont.files,
                [subFamily]: file
            },
            postscriptNames: {
                ...origFont.postscriptNames,
                [subFamily]: postscript
            },
            alternativeFamilies: {
                ...origFont.alternativeFamilies,
                [subFamily]: alternativeFamilies
            },
            alternativeSubFamilies: {
                ...origFont.alternativeSubFamilies,
                [subFamily]: alternativeSubFamilies
            }
        });
    } else {
        return m.set(family, {
            family,
            systemFont,
            subFamilies: [subFamily],
            files: {
                [subFamily]: file
            },
            postscriptNames: {
                [subFamily]: postscript
            },
            alternativeFamilies: {
                [subFamily]: alternativeFamilies
            },
            alternativeSubFamilies: {
                [subFamily]: alternativeSubFamilies
            }
        });
    }
};

const reorderWithAlt = (fonts) => {
    fonts.forEach(name => {
        const { alternativeFamilies, alternativeSubFamilies, family } = name;
        if(alternativeFamilies && alternativeSubFamilies) {
            for(const type in alternativeFamilies) {
                const altFamilies = alternativeFamilies[type];
                altFamilies.forEach((altFamily, index) => {
                    if(altFamily && family !== altFamily) {
                        const file = name.files[type];
                        const postscriptName = name.postscriptNames[type];
                        const altSubFamily = alternativeSubFamilies[type][index];
                        let existingFamily = null;
                        for(let i=0; i<fonts.length; i++) {
                            if(fonts[i].family === altFamily) {
                                existingFamily = fonts[i];
                                break;
                            }
                        }
                        if(existingFamily) {
                            if(existingFamily.subFamilies.indexOf(altSubFamily) === -1) {
                                existingFamily.subFamilies.push(altSubFamily);
                                existingFamily.files[altSubFamily] = file;
                                existingFamily.postscriptNames[altSubFamily] = postscriptName;
                            } 
                        } else {
                            fonts.push({
                                family: altFamily,
                                systemFont: name.systemFont,
                                subFamilies: [altSubFamily],
                                files: {
                                   [altSubFamily]: file
                                },
                                postscriptNames: {
                                    [altSubFamily]: postscriptName
                                },
                                alternativeFamilies: [],
                                alternativeSubFamilies: []
                            });
                        }
                    }
                });
            }
        }
    });
    return fonts;
};

const SystemFonts = function (options = {}) {

    let allFontFiles = [];
    let fontFiles = [];
    const { ignoreSystemFonts = false, customDirs = [], fontkit } = options;

    const debug = (title, msg) => {
        if(options.debug) {
            console.log(title, typeof msg !== 'function' ? msg : msg());
        }
    };

    if (!Array.isArray(customDirs)) {
        throw new Error('customDirs must be an array of folder path strings');
    }

    const customDirSet = new Set(customDirs);
    const customFontFiles = new Set();

    const getFontFiles = () => {

        let directories = [];

        if (customDirs.length > 0) {
            directories = [...customDirs];
        }

        const platform = getPlatform();
        if (platform === 'osx') {
            const home = process.env.HOME;
            directories = [
                ...directories,
                path.join(home, 'Library', 'Fonts'),
                path.join('/', 'Library', 'Fonts'),
                path.join('/', 'System', 'Library', 'Fonts'),
                path.join(os.homedir(), 'Library', 'Application Support', 'Adobe', 'CoreSync', 'plugins', 'livetype', '.r')
            ];
        } else if (platform === 'windows') {
            const winDir = process.env.windir || process.env.WINDIR;
            directories = [
                ...directories,
                path.join(path.resolve(process.env.APPDATA, '..'), 'Local', 'Microsoft', 'Windows', 'Fonts'),
                path.join(winDir, 'Fonts'),
                path.join(os.homedir(), 'AppData', 'Roaming', 'Adobe', 'CoreSync', 'plugins', 'livetype', 'r')
            ];
        } else { // some flavor of Linux, most likely
            const home = process.env.HOME;
            directories = [
                ...directories,
                path.join(home, '.fonts'),
                path.join(home, '.local', 'share', 'fonts'),
                path.join('/', 'usr', 'share', 'fonts'),
                path.join('/', 'usr', 'local', 'share', 'fonts')
            ];
        }

        debug('Directories', directories);

        return directories
            .reduce((arr, d) => {
                const files = recGetFile(d);
                if (customDirSet.has(d)) {
                    files.forEach(f => customFontFiles.add(f));
                }
                return arr.concat(files);
            }, []);
    };

    

    // this list includes all TTF, OTF, OTC, and DFONT files
    this.getAllFontFilesSync = () => [...allFontFiles];

    this.initFontFiles = () => {
        allFontFiles = getFontFiles();
        fontFiles = filterReadableFonts(allFontFiles);
        // debug('All fonts after filter', () => {
        //     fontFiles.forEach(font => console.log(font));
        // });
    };

    this.initFontFiles();

    this.getFontInfo = (file) => new Promise(resolve1 => {
        ttfInfo.get(file, (err, fontMeta) => {
            if (!fontMeta) {
                if(fontkit) {
                    fontkit.open(file, null, (err2, fontMeta2) => {
                        if(!fontMeta2) {
                            debug('Error reading font ' + file, err2);
                            resolve1(null);
                        } else {
                            const fonts = fontMeta2.fonts || fontMeta2;
                            const fontInfos = fonts.map(font => fontkitTableToObj(font, file, !customFontFiles.has(file)));
                            resolve1(fontInfos.length === 0 ? null : fontInfos.length === 1 ? fontInfos[0] : fontInfos);
                        }
                    });
                } else {
                    debug('Error reading font ' + file, err);
                    resolve1(null);
                }
            } else {
                const fontInfos = ttfInfoTableToObj(fontMeta.tables.name, file, !customFontFiles.has(file));
                resolve1(fontInfos);
            }
        });
    });

    this.getFontInfoSync = (file) => {
        try {
            const fontMeta = ttfInfo.getSync(file);
            return ttfInfoTableToObj(fontMeta.tables.name, file, !customFontFiles.has(file));
        } catch (err) {
            try {
                if(fontkit) {
                    const fontMeta2 = fontkit.openSync(file);
                    const fonts = fontMeta2.fonts || fontMeta2;
                    const fontInfos = fonts.map(font => fontkitTableToObj(font, file, !customFontFiles.has(file)));
                    return fontInfos.length === 0 ? null : fontInfos.length === 1 ? fontInfos[0] : fontInfos;
                } else {
                    debug('Error reading font ' + file, err);
                }
            } catch(err2) {
                debug('Error reading font ' + file, err2);
            }
        }
        return null;
    };

    // this list includes all TTF and OTF files (these are the ones we parse in this lib)
    this.getFontFilesSync = () => [...fontFiles];

    this.getFontsExtended = () => new Promise((resolve, reject) => {

        const promiseList = [];

        const filteredFontFiles = !ignoreSystemFonts ? [...fontFiles] : fontFiles
            .filter(f => customFontFiles.has(f));

        filteredFontFiles.forEach(file => promiseList.push(this.getFontInfo(file)));
        Promise.all(promiseList).then(
            (_res) => {
                const res = [];
                _res.forEach(fonts => {
                    if(fonts) {
                        if(fonts.length) {
                            fonts.forEach(font => res.push(font));
                        } else res.push(fonts);
                    }
                });
                const names = res.reduce(extendedReducer, new Map());
                const namesArr = [...names.values()]
                    .sort((a, b) => a.family.localeCompare(b.family));

                resolve(reorderWithAlt(namesArr));
            },
            (err) => reject(err)
        );
    });

    this.getFontsExtendedSync = () => {

        const filteredFontFiles = !ignoreSystemFonts ? [...fontFiles] : fontFiles
            .filter(f => customFontFiles.has(f));

        const res = [];
        filteredFontFiles.forEach(font => {
            const metas = this.getFontInfoSync(font);
            if(metas) {
                if(metas.length) {
                    metas.forEach(meta => res.push(meta));
                } else res.push(metas);
            }
        });
        const names = res.reduce(extendedReducer, new Map());
        const namesArr = [...names.values()]
            .sort((a, b) => a.family.localeCompare(b.family));
        return reorderWithAlt(namesArr);
    };

    this.getFonts = () => new Promise((resolve, reject) => {
        this.getFontsExtended()
            .then(fontList => {
                const names = fontList
                    .map(({ family }) => family)
                    .reduce((obj, name) => {
                        obj[name] = 1;
                        return obj;
                    }, {});
                resolve(Object.keys(names).sort((a, b) => a.localeCompare(b)));
            })
            .catch(err => reject(err));
    });

    this.getFontsSync = () => {
        const names = this.getFontsExtendedSync()
            .map(({ family }) => family)
            .reduce((obj, name) => {
                obj[name] = 1;
                return obj;
            }, {});
        return Object.keys(names).sort((a, b) => a.localeCompare(b));
    };

    this.searchFonts = (fonts, search_request) => {
        const search = [];
        search_request.forEach(new_search => {
            let { family, style } = new_search;
            if (style && typeof style !== 'object') style = [style];
            let is_sorted = false;
            for (let i = 0; i < search.length; i++) {
                if (search[i].family === family) {
                    is_sorted = true;
                    if (!style) search[i] = new_search;
                    else if (search[i].style) {
                        style.forEach(new_style => {
                            if (search[i].style.indexOf(new_style) === -1) {
                                search[i].style.push(new_style);
                            }
                        });
                    }
                    break;
                }
            }
            if (!is_sorted) {
                const new_search = { family };
                if (style) new_search.style = style;
                search.push(new_search);
            }
        });

        const found = [];
        const missing = [];
        search.forEach(new_search => {
            let found_font = false;
            const { family, style } = new_search;
            for (let i = 0; i < fonts.length; i++) {
                if (family === fonts[i].family) {
                    found_font = true;
                    const { files } = fonts[i];
                    if (style) {
                        style.forEach(new_style => {
                            const return_font = {
                                family,
                                style: new_style
                            };
                            if (files[new_style]) {
                                return_font.file = files[new_style];
                                found.push(return_font);
                            } else missing.push(return_font);
                        });
                    } else {
                        for (const key in files) {
                            found.push({
                                family,
                                style: key,
                                file: files[key]
                            });
                        }
                    }
                    break;
                }
            }
            if (!found_font) {
                if (style) {
                    style.forEach(fontStyle => {
                        missing.push({
                            family,
                            style: fontStyle
                        });
                    });
                } else missing.push({ family });
            }
        });
        return { found, missing };
    };

    this.findFonts = (search) => {
        return new Promise((resolve, reject) => {
            this.getFontsExtended()
                .then(fonts => {
                    resolve(this.searchFonts(fonts, search));
                }).catch(err => reject(err));
        });
    };

    this.findFontsSync = (search) => {
        const fonts = this.getFontsExtendedSync();
        return this.searchFonts(fonts, search);
    };

    // Do not use if you haven't admin rights
    this._DEPRECATED_jsInstallFonts = (fonts) => new Promise((resolve, reject) => {
        if (getPlatform() !== 'windows') reject('Installation method isn\'t available with your OS');
        else {
            const winDir = process.env.windir || process.env.WINDIR;
            const fontsDir = path.join(winDir, 'Fonts');
            const promises = [];
            fonts.forEach(font => {
                const fileName = path.basename(font);
                promises.push(
                    new Promise((resolve, reject) => {
                        const fontPath = fontsDir + '/' + fileName;
                        fs.copyFile(font, fontPath, (err) => {
                            if (err) reject(err);
                            else resolve(fontPath);
                        });
                    })
                );
            });
            Promise.all(promises).then(paths => {
                resolve(paths);
            }).catch(e => reject(e));
        }
    });

    this.installFonts = (fonts, tmpDir = null, timeout = 20000) => new Promise((resolve, reject) => {
        if(getPlatform() !== 'windows') reject('Installation method isn\'t available with your OS');
        else {
            const fontsToInstall = [];
            const searchFonts = [];
            fonts.forEach((font) => {
                font = path.resolve(font);
                try {
                    let fontInfos = this.getFontInfoSync(font);
                    if(fontInfos) {
                        if(fontInfos.length) fontInfos = fontInfos[0];
                        const { family, subFamily } = fontInfos;
                        searchFonts.push({ family, style: subFamily, path: font });
                    } else fontsToInstall.push(font);
                } catch (e) {
                    console.error(e);
                    fontsToInstall.push(font);
                }
            });
            const installedFonts = this.getFontsExtendedSync();
            const foundFonts = [];
            const missingFonts = [];
            for(let i=0; i<searchFonts.length; i++) {
                const search = searchFonts[i];
                const { found, missing } = this.searchFonts(installedFonts, [search]);
                if(found.length > 0) foundFonts.push(found[0]);
                if(missing.length > 0) missingFonts.push({ ...missing[0], path: search.path });
            }
            if(missingFonts.length > 0) {
                let tmpScript = null;
                const cleanTmpScript = () => {
                    if (tmpScript) fs.unlink(tmpScript, (err) => { if (err) console.error(err); });
                };
                const handleError = err => {
                    cleanTmpScript();
                    reject(err);
                };
                let vbsContent = `
                    Const FONTS = &H14&
                    nInstall = 0
                    Set objShell = CreateObject("Shell.Application")
                    Set ofso = CreateObject("Scripting.FileSystemObject")
                    Set oWinFonts = objShell.Namespace(FONTS)
                    Set wshShell = CreateObject( "WScript.Shell" )
                    strUserName = wshShell.ExpandEnvironmentStrings( "%USERNAME%" )
                    oWinFonts2 = "C:\\Users\\" & strUserName & "\\AppData\\Local\\Microsoft\\Windows\\Fonts"
                    Dim sources(${fonts.length})
                `;
                missingFonts.forEach((font, index) => {
                    vbsContent += `sources(${index}) = "${font.path}"\n`;
                });
                vbsContent += `
                    Set regEx = New RegExp
                    regEx.IgnoreCase = True
                    regEx.Pattern = "([\\w\\s]+?)(_[^_]*)?(\\.(ttf|otf|ttc))$"
                    FOR EACH FontFile IN sources
                    fontFileName = ofso.GetFileName(FontFile)
                    IF regEx.Test(fontFileName) THEN    
                    Set objMatch = regEx.Execute(fontFileName)
                    otherName = Replace(fontFileName,objMatch.Item(0).Submatches(2),"") & "_0" & objMatch.Item(0).Submatches(2)
                    normalFontPath = oWinFonts.Self.Path & "\\" & fontFileName
                    normalFontPath2 = oWinFonts2 & "\\" & fontFileName
                    otherFontPath = oWinFonts.Self.Path & "\\" & otherName
                    otherFontPath2 = oWinFonts2 & "\\" & otherName
                    IF NOT ofso.FileExists(normalFontPath) AND NOT ofso.FileExists(normalFontPath2) AND NOT ofso.FileExists(otherFontPath) AND NOT ofso.FileExists(otherFontPath2) THEN
                    oWinFonts.CopyHere FontFile
                    nInstall = nInstall + 1
                    END IF
                    END IF
                    NEXT
                    wscript.echo nInstall
                `;
                if (!tmpDir) tmpDir = __dirname;
                tmpScript = path.normalize(tmpDir + '/tmp_node_font_install.vbs');
                fs.writeFile(tmpScript, vbsContent, 'utf-8', (err) => {
                    if (err) handleError(err);
                    else {
                        const process = spawn('cscript.exe', [tmpScript]);
                        let data = null;
                        let processErr = null;
                        let end = false;
                        process.stdout.on('data', (_data) => {
                            _data = _data.toString('utf8');
                            data = isNaN(_data) ? 0 : parseInt(_data);
                        });
        
                        process.stderr.on('data', (_err) => {
                            _err = _err.toString('utf8');
                            if (_err) processErr = _err;
                        });
    
                        const autoKill = setTimeout(() => {
                            if (!end) {
                                console.error('Kill font install process after ' + timeout/1000 + ' seconds timeout');
                                process.kill();
                            }
                        }, timeout);
        
                        process.on('close', () => {
                            end = true;
                            clearTimeout(autoKill);
                            if (processErr) handleError(processErr);
                            else {
                                cleanTmpScript();
                                this.initFontFiles();
                                const newInstalledFonts = this.getFontsExtendedSync();
                                const newMissingFonts = [];
                                const installed = [];
                                for(let i=0; i<missingFonts.length; i++) {
                                    const search = this.searchFonts(newInstalledFonts, [missingFonts[i]]);
                                    const { found } = search;
                                    if(found.length > 0) installed.push({ ...found[0], path: missingFonts[i].path });
                                    else newMissingFonts.push(missingFonts[i]);
                                }
                                resolve({
                                    success: newMissingFonts.length === 0,
                                    found: foundFonts,
                                    missing: newMissingFonts,
                                    installed,
                                    vbsInstalledQte: data
                                });
                            }
                        });
                    }
                });
            } else {
                resolve({
                    success: true,
                    found: foundFonts,
                    missing: [],
                    installed: [],
                    vbsInstalledQte: 0
                });
            }
        }
    });

};

export default SystemFonts;
