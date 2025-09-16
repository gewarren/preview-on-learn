const path = require('path');

module.exports = {
    entry: {
        content: './scripts/content.js'
    },
    output: {
        filename: '[name].bundle.js',
        path: path.resolve(__dirname, 'dist')
    },
    mode: 'production'
};
