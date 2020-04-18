'use strict';

const _ = require('lodash');
const { 'default': Sheets } = require('node-sheets');
const weighted = require('weighted');

const dataPromise = (async function loadData() {
    const sheet = new Sheets(process.env.SHEET_ID || '1kgbgBHRPOegL_fpQMn37UEsMk0h3OXfSbutV8UJZtYw');
    await sheet.authorizeApiKey(process.env.API_KEY || 'AIzaSyCp94EJsdc1J-vDwEuW_PGeQekPL8o9k-0');
    const syllableFrequencyData =  _.chain((await sheet.tables('A:B')).rows)
        .filter(row => row.Frequency && row.Frequency.value &&
                        row.Syllable && row.Syllable.value)
        .map(row => _.mapValues(row, v => v.value))
        .value();
    const syllables = _.map(syllableFrequencyData, 'Syllable');
    const frequencies = _.map(syllableFrequencyData, 'Frequency');

    const syllablePerWordData = _.chain((await sheet.tables('D:E')).rows)
        .filter(row => row.Frequency && row.Frequency.value &&
                        row.SyllablesPerWord && row.SyllablesPerWord.value)
        .map(row => _.mapValues(row, v => v.value))
        .value();
    const syllableCounts = _.map(syllablePerWordData, 'SyllablesPerWord');
    const syllableCountFrequencies = _.map(syllablePerWordData, 'Frequency');

    return { syllables, frequencies, syllableCounts, syllableCountFrequencies };
})();

module.exports.makeLingo = async (event) => {
    const { syllables, frequencies, syllableCounts, syllableCountFrequencies } = await dataPromise;

    const words = [];
    for(let i = 0; i < (event.queryStringParameters && event.queryStringParameters.words || 100); i++) {
        const syllables_for_this_word = event.queryStringParameters && event.queryStringParameters.syllables || weighted.select(syllableCounts, syllableCountFrequencies);
        let word = '';
        for(let s = 0; s < syllables_for_this_word; s++) {
            word = `${word}${weighted.select(syllables, frequencies)}`;
        }
        words.push(word);
    }

    return words;
};
