// Parse fullName ("LASTNAME, FIRSTNAME MIDDLENAME SUFFIX") into segregated parts
function parseFullNameIntoParts(fullName) {
    if (!fullName) return {};
    const suffixes = ['Jr.', 'Sr.', 'III', 'IV', 'V', 'II'];
    const parts = fullName.split(',');
    const lastName = (parts[0] || '').trim();
    const rest = (parts.slice(1).join(',') || '').trim();
    let suffix = '', firstName = '', middleName = '';
    if (rest) {
        const words = rest.split(/\s+/);
        if (words.length > 0 && suffixes.includes(words[words.length - 1])) {
            suffix = words.pop();
        }
        firstName = words[0] || '';
        middleName = words.slice(1).join(' ');
    }
    return { firstName, lastName, middleName, suffix };
}

module.exports = { parseFullNameIntoParts };
