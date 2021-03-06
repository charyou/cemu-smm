const Promise = require("bluebird");
const crc32   = require("buffer-crc32");

const fs   = require("fs");
const path = require("path");

const createCourse = require("./course");
const Tnl = require("./tnl");

const SAVE_SIZE  = 0xA000;

const SAVE_ORDER_OFFSET = 0x4340;
const SAVE_ORDER_SIZE = 120;
const SAVE_ORDER_EMPTY = 0xFF;

const SAVE_AMIIBO_OFFSET = 0x85E0;
const SAVE_AMIIBO_LENGTH = 0x14;

const SAVE_CRC_LENGTH = 0x10;
const SAVE_CRC_PRE_BUF  = Buffer.from("0000000000000015", "hex");
const SAVE_CRC_POST_BUF = Buffer.alloc(4);

module.exports = Save;

function Save(pathToSave, data) {
    this.pathToSave = pathToSave;
    this.data = data;
    this.courses = {};

    this.slotToIndex = {};
    for (let i = 0; i < SAVE_ORDER_SIZE; i++) {
        let index = this.data.readUInt8(SAVE_ORDER_OFFSET + i);
        if (index !== 255) {
            this.slotToIndex[i] = index;
        }
    }
}

Save.prototype = {

    writeCrc: async function () {

        await new Promise((resolve) => {
            try {
                let fileWithoutCrc = this.data.slice(16);
                let crc = Buffer.alloc(4);
                crc.writeUInt32BE(crc32.unsigned(fileWithoutCrc), 0);
                let crcBuffer = Buffer.concat([SAVE_CRC_PRE_BUF, crc, SAVE_CRC_POST_BUF], SAVE_CRC_LENGTH);
                this.data = Buffer.concat([crcBuffer, fileWithoutCrc], SAVE_SIZE);
                fs.writeFile(path.resolve(`${this.pathToSave}/save.dat`), this.data, null, () => {
                    resolve();
                })
            } catch (err) {
                console.log(err);
            }
        });

    },

    reorder: async function () {

        await new Promise(async (resolve) => {
            try {
                // rename course folders
                let promises = [];
                let slotToIndex = {};
                Object.assign(slotToIndex, this.slotToIndex);
                for (let i in slotToIndex) {
                    promises.push(new Promise((resolve) => {
                        let value = slotToIndex[i];
                        let srcPath = path.resolve(`${this.pathToSave}/course${parseInt(i).pad(3)}`);
                        let dstPath = path.resolve(`${this.pathToSave}/course${value.pad(3)}_reorder`);
                        fs.rename(srcPath, dstPath, () => {
                            this.slotToIndex[value] = value;
                            this.data.writeUInt8(value, SAVE_ORDER_OFFSET + value);
                            resolve();
                        });
                        resolve();
                    }));
                }
                await Promise.all(promises);
                promises = [];
                for (let i = 0; i < SAVE_ORDER_SIZE; i++) {
                    promises.push(new Promise((resolve) => {
                        let srcPath = path.resolve(`${this.pathToSave}/course${i.pad(3)}_reorder`);
                        let dstPath = path.resolve(`${this.pathToSave}/course${i.pad(3)}`);
                        fs.rename(srcPath, dstPath, (err) => {
                            if (err) {
                                if (this.slotToIndex[i]) {
                                    delete this.slotToIndex[i];
                                }
                                this.data.writeUInt8(SAVE_ORDER_EMPTY, SAVE_ORDER_OFFSET + i);
                            }
                            resolve();
                        });
                    }));
                }
                await Promise.all(promises);

                // recalculate checksum
                this.writeCrc();

                resolve();
            } catch (err) {
                console.log(err);
                // TODO undo changes
            }
        });

    },

    reorderSync: function () {

        try {
            // rename course folders
            let slotToIndex = {};
            Object.assign(slotToIndex, this.slotToIndex);
            for (let i in this.slotToIndex) {
                let value = slotToIndex[i];
                let srcPath = path.resolve(`${this.pathToSave}/course${parseInt(i).pad(3)}`);
                let dstPath = path.resolve(`${this.pathToSave}/course${value.pad(3)}_reorder`);
                fs.renameSync(srcPath, dstPath);
                this.slotToIndex[value] = value;
                this.data.writeUInt8(value, SAVE_ORDER_OFFSET + value);
            }
            for (let i = 0; i < SAVE_ORDER_SIZE; i++) {
                let srcPath = path.resolve(`${this.pathToSave}/course${i.pad(3)}_reorder`);
                let dstPath = path.resolve(`${this.pathToSave}/course${i.pad(3)}`);
                try {
                    fs.renameSync(srcPath, dstPath);
                } catch (err) {
                    if (this.slotToIndex[i]) {
                        delete this.slotToIndex[i];
                    }
                    this.data.writeUInt8(SAVE_ORDER_EMPTY, SAVE_ORDER_OFFSET + i);
                }
            }

            // recalculate checksum
            this.writeCrc();
        } catch (err) {
            console.log(err);
            // TODO undo changes
        }

    },

    exportJpeg: async function () {

        let promises = [];
        for (let i = 0; i < SAVE_ORDER_SIZE; i++) {
            let coursePath = path.resolve(`${this.pathToSave}/course${i.pad(3)}/`);
            promises.push(new Promise(async (resolve) => {
                let exists = false;
                await new Promise((resolve) => {
                    fs.access(coursePath, fs.constants.R_OK | fs.constants.W_OK, (err) => {
                        exists = !err;
                        resolve();
                    });
                });
                if (exists) {
                    await Promise.all([
                        new Promise(async (resolve) => {
                            try {
                                let tnl = new Tnl(coursePath + "/thumbnail0.tnl");
                                let jpeg = await tnl.toJpeg();
                                fs.writeFile(coursePath + "/thumbnail0.jpg", jpeg, null, () => {
                                    resolve();
                                })
                            } catch (err) {
                                resolve();
                            }
                        }),
                        new Promise(async (resolve) => {
                            try {
                                let tnl = new Tnl(coursePath + "/thumbnail1.tnl");
                                let jpeg = await tnl.toJpeg();
                                fs.writeFile(coursePath + "/thumbnail1.jpg", jpeg, null, () => {
                                    resolve();
                                });
                            } catch (err) {
                                resolve();
                            }
                        })
                    ]);
                }
                resolve();
            }));
        }
        await Promise.all(promises);

    },

    exportJpegSync: function () {

        for (let i = 0; i < SAVE_ORDER_SIZE; i++) {
            let coursePath = path.resolve(`${this.pathToSave}/course${i.pad(3)}/`);
            let exists = true;
            try {
                fs.accessSync(coursePath, fs.constants.R_OK | fs.constants.W_OK);
            } catch (err) {
                exists = false;
            }
            if (exists) {
                try {
                    let tnl = new Tnl(coursePath + "/thumbnail0.tnl");
                    let jpeg = tnl.toJpegSync();
                    fs.writeFileSync(coursePath + "/thumbnail0.jpg", jpeg)
                } catch (err) {
                }
                try {
                    let tnl = new Tnl(coursePath + "/thumbnail1.tnl");
                    let jpeg = tnl.toJpegSync();
                    fs.writeFileSync(coursePath + "/thumbnail1.jpg", jpeg);
                } catch (err) {
                }
            }
        }

    },

    importJpeg: async function () {

        let promises = [];
        for (let i = 0; i < SAVE_ORDER_SIZE; i++) {
            let coursePath = path.resolve(`${this.pathToSave}/course${i.pad(3)}/`);
            promises.push(new Promise(async (resolve) => {
                let exists = false;
                await new Promise((resolve) => {
                    fs.access(coursePath, fs.constants.R_OK | fs.constants.W_OK, (err) => {
                        exists = !err;
                        resolve();
                    });
                });
                if (exists) {
                    await Promise.all([
                        new Promise(async (resolve) => {
                            try {
                                let jpeg = new Tnl(coursePath + "/thumbnail0.jpg");
                                let tnl = await jpeg.fromJpeg(true);
                                fs.writeFile(coursePath + "/thumbnail0.tnl", tnl, null, () => {
                                    resolve();
                                })
                            } catch (err) {
                                resolve();
                            }
                        }),
                        new Promise(async (resolve) => {
                            try {
                                let jpeg = new Tnl(coursePath + "/thumbnail1.jpg");
                                let tnl = await jpeg.fromJpeg(false);
                                fs.writeFile(coursePath + "/thumbnail1.tnl", tnl, null, () => {
                                    resolve();
                                });
                            } catch (err) {
                                resolve();
                            }
                        })
                    ]);
                }
                resolve();
            }));
        }
        await Promise.all(promises);

    },

    unlockAmiibos: async function () {

        await new Promise(async (resolve) => {
            for (let i = 0; i < SAVE_AMIIBO_LENGTH; i++) {
                this.data.writeUInt8(0xFF, SAVE_AMIIBO_OFFSET + i);
            }
            await this.writeCrc();
            resolve();
        })

    },

    loadCourses: async function () {

        let promises = [];
        for (let i = 0; i < SAVE_ORDER_SIZE; i++) {
            promises.push(new Promise(async (resolve) => {
                let exists = false;
                let courseName = `course${i.pad(3)}`;
                let coursePath = path.resolve(`${this.pathToSave}/${courseName}/`);
                await new Promise((resolve) => {
                    fs.access(coursePath, fs.constants.R_OK | fs.constants.W_OK, (err) => {
                        exists = !err;
                        resolve();
                    });
                });
                if (exists) {
                    this.courses[courseName] = await createCourse(i, coursePath);
                }
                resolve();
            }));
        }
        await Promise.all(promises);
        return this.courses;

    },

    loadCoursesSync: async function () {

        for (let i = 0; i < SAVE_ORDER_SIZE; i++) {
            let courseName = `course${i.pad(3)}`;
            let coursePath = path.resolve(`${this.pathToSave}/${courseName}/`);
            try {
                fs.accessSync(coursePath, fs.constants.R_OK | fs.constants.W_OK);
                this.courses[courseName] = await createCourse(i, coursePath);
            } catch (err) {
            }
        }
        return this.courses;

    },

    loadCourseElements: function () {

        for (let key in this.courses) {
            //noinspection JSUnfilteredForInLoop
            this.courses[key].loadElements();
        }

    }

};

Number.prototype.pad = function(size) {
    let s = String(this);
    while (s.length < (size || 2)) {s = "0" + s;}
    return s;
};