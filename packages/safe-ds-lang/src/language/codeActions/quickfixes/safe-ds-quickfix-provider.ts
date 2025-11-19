import { Diagnostic } from 'vscode-languageserver';
import { LangiumDocument } from 'langium';

import { CODE_ARGUMENT_POSITIONAL } from '../../validation/other/expressions/arguments.js';
import { CODE_STYLE_UNNECESSARY_BODY } from '../../validation/style.js';
import { CODE_STYLE_UNNECESSARY_ARGUMENT_LIST } from '../../validation/style.js';
import { CODE_PARAMETER_BOUND_INVALID_VALUE } from '../../validation/other/declarations/parameterBounds.js';

import { SafeDsServices } from '../../safe-ds-module.js';
import { CodeActionAcceptor } from '../safe-ds-code-action-provider.js';

import { makeArgumentsAssignedToOptionalParametersNamed } from './arguments.js';
import { removeUnnecessaryBody } from './body.js';
import { removeUnnecessaryArgumentList } from './argument-list.js';
import { setArgumentsToParameterBounds } from './para-bounds.js';


export class SafeDsQuickfixProvider {
    private readonly registry: QuickfixRegistry;

    constructor(services: SafeDsServices) {
        this.registry = {
            [CODE_ARGUMENT_POSITIONAL]: [makeArgumentsAssignedToOptionalParametersNamed(services)],
            [CODE_STYLE_UNNECESSARY_BODY]: [removeUnnecessaryBody(services)],
            [CODE_STYLE_UNNECESSARY_ARGUMENT_LIST]: [removeUnnecessaryArgumentList(services)],
            [CODE_PARAMETER_BOUND_INVALID_VALUE]: [setArgumentsToParameterBounds(services)],
        };
    }

    createQuickfixes(diagnostic: Diagnostic, document: LangiumDocument, acceptor: CodeActionAcceptor) {
        if (!diagnostic.code) {
            /* c8 ignore next 2 */
            return;
        }

        const quickfixes = this.registry[diagnostic.code] ?? [];
        for (const quickfix of quickfixes) {
            quickfix(diagnostic, document, acceptor);
        }
    }
}

type QuickfixRegistry = {
    [code: string | number]: QuickfixCreator[];
};

type QuickfixCreator = (diagnostic: Diagnostic, document: LangiumDocument, acceptor: CodeActionAcceptor) => void;
