'use strict';

const
    fs = require('fs'),
    path = require('path'),
    spawn = require('child_process').spawn,
    istanbul = require('istanbul'); // http://gotwarlost.github.io/istanbul/public/apidocs/

class IstanbulWrapper {
    constructor() {
        this.instrumenter = new istanbul.Instrumenter();
        this.collector = new istanbul.Collector();
        this.main = '';
        // assume the tmp directory has alrady been created
        this.tmpDir = path.join(process.cwd(), 'tmp');
        this.coverageJson = path.join(this.tmpDir, 'coverage.json');
    }

    /*
        instrument the js code in the tmp folder.

        @param {String} tmpSrc - the js file in tmp to instrument
        @param {String} realSrc - the path to the actual js code
    */
    instrument(tmpSrc, realSrc) {
        let ic = this.instrumenter.instrumentSync(
            fs.readFileSync(tmpSrc, {encoding: 'utf8'}),
            realSrc // used for generating reports
        );
        fs.writeFileSync(tmpSrc, ic);
    }

    /*
        inject the capture code into app.js AFTER instrument() have been called.
        this is to ensure that if app.js wants to be instrumented by the user, the injection code doesn't affect the code coverage data.
    */
    injectCapture() {
        const appJsFile = path.join(this.tmpDir, 'app.js');
        let appJs = fs.readFileSync(appJsFile, {encoding: 'utf8'});
        appJs += '\n';
        appJs += `process.on('SIGINT', function () { require("fs").writeFileSync("${this.coverageJson}", JSON.stringify(global.__coverage__)); process.exit(); });`;
        fs.writeFileSync(appJsFile, appJs);
    }

    /*
        run the Arrow project

        @param {String} waitForLog - the log output to watch for in order to call cb function
        @param {Function} cb - the callback function to call once  waitForLog is found
    */
    runArrow(waitForLog, cb) {
        const waitForLogExp = new RegExp(waitForLog);

        const runCmd = spawn('appc', ['run', '--project-dir', `${this.tmpDir}`]);
        runCmd.stdout.on('data', data => {
            let output = data.toString();
            console.log(output);

            if (waitForLogExp.test(output.trim())) {
                cb();
            }
        });
        runCmd.stderr.on('data', data => {
            console.log(data.toString());
        });

        // need the child process pid, so it can be killed later
        fs.writeFileSync(path.join(process.cwd(), 'child.pid'), runCmd.pid);
    }

    /*
        get this.coverageJson and add it to istanbul.Collector.
        however, because this.coverageJson will not be created until the Arrow project receives SIGINT signal (see injectCapture()),
        will need to keep polling for the existance of this.coverageJson before moving on.
    */
    gatherCoverage() {
        checkIfExist.call(this);
        function checkIfExist() {
            try {
                fs.statSync(this.coverageJson);
                this.collector.add(require(this.coverageJson));
            }
            catch (err) {
                checkIfExist.call(this);
            }
        }
    }

    /*
        generate the code coverage report into the specified directory.
        by default, the html code coverage will be generated if no properties are specified in the options property.

        @param {Object} options - the grunt's task option property should contain either htmlLcov or lcovOnly
        @param {String} dest - the directory to generate the report into
    */
    makeReport(options, dest) {
        // using default istanbul configuration; hence, the false argument
        const reporter = new istanbul.Reporter(false, dest);

        // default code coverage report
        let report = 'html';
        if (options) {
            if (options.htmlLcov) {
                // per istanbul api: http://gotwarlost.github.io/istanbul/public/apidocs/classes/LcovReport.html
                report = 'lcov';
            }
            else if (options.lcovOnly) {
                report = 'lcovonly';
            }
            else if (options.cobertura) {
                report = 'cobertura';
            }
        }
        reporter.add(report);
        // writing the reports synchronously; hence, the true argument
        reporter.write(this.collector, true, () => { /* do nothing */ });
    }
}
module.exports = IstanbulWrapper;