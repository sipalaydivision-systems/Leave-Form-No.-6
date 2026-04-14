#!/usr/bin/env node
/**
 * Hook helper: check-diagram-impact.js
 * Reads PostToolUse stdin JSON. If the edited file is a backend/data-model
 * file that could affect system-diagrams.html, outputs an additionalContext
 * block reminding Claude to update ERD / DFD / Context Diagram.
 */
'use strict';

let raw = '';
process.stdin.on('data', chunk => { raw += chunk; });
process.stdin.on('end', () => {
    try {
        const event = JSON.parse(raw);
        const filePath = (event.tool_input && event.tool_input.file_path) || '';

        // Patterns that could affect ERD / DFD / Context Diagram
        const relevant = [
            'server.js',
            '/src/routes/',
            '/src/services/',
            '/src/data/',
            '/src/middleware/',
            '/src/app.js',
            '/src/config/'
        ];

        const skip = [
            'system-diagrams.html',
            '/public/css/',
            '/public/libs/',
            '/public/icons/',
            '.json',         // data files, not schema changes
            'settings',
            'check-diagram'
        ];

        const isRelevant = relevant.some(p => filePath.replace(/\\/g, '/').includes(p));
        const shouldSkip = skip.some(p => filePath.replace(/\\/g, '/').includes(p));

        if (isRelevant && !shouldSkip) {
            const msg = [
                'DIAGRAM IMPACT CHECK — ' + filePath + ' was just edited.',
                'Before finishing this response, assess whether the change affects public/system-diagrams.html:',
                '  • ERD (Full System tab): new entity, removed entity, changed attributes, new relationship, changed cardinality',
                '  • DFD Level 0 (DFD tab): new external entity, new data store, new data flow arrow, changed process name',
                '  • Context Diagram (Context tab): new external actor, new system boundary, changed data flow label',
                'If any diagram is stale, update the relevant SVG/HTML in public/system-diagrams.html now.'
            ].join('\n');

            process.stdout.write(JSON.stringify({
                hookSpecificOutput: {
                    hookEventName: 'PostToolUse',
                    additionalContext: msg
                }
            }));
        }
    } catch (e) {
        // Silent — never block a tool call
    }
});
