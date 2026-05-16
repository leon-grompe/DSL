import { isSdsClass, SdsClass } from '../generated/ast.js';
import { SafeDsModuleMembers } from './safe-ds-module-members.js';
import { resourceNameToUri } from '../../helpers/resources.js';
import { URI } from 'langium';

const CELL_URI = resourceNameToUri('builtins/safeds/data/tabular/containers/Cell.sdsstub');
const COLUMN_URI = resourceNameToUri('builtins/safeds/data/tabular/containers/Column.sdsstub');
const CORE_CLASSES_URI = resourceNameToUri('builtins/safeds/lang/coreClasses.sdsstub');
const IMAGE_URI = resourceNameToUri('builtins/safeds/data/image/containers/Image.sdsstub');
const IMAGE_LIST_URI = resourceNameToUri('builtins/safeds/data/image/containers/ImageList.sdsstub');
const ROW_URI = resourceNameToUri('builtins/safeds/data/tabular/containers/Row.sdsstub');
const TABLE_URI = resourceNameToUri('builtins/safeds/data/tabular/containers/Table.sdsstub');
const DATASET_URI = resourceNameToUri('builtins/safeds/data/labeled/containers/Dataset.sdsstub');
const TABULAR_DATASET_URI = resourceNameToUri('builtins/safeds/data/labeled/containers/TabularDataset.sdsstub');

export class SafeDsClasses extends SafeDsModuleMembers<SdsClass> {
    get Any(): SdsClass | undefined {
        return this.getClass('Any');
    }

    get Boolean(): SdsClass | undefined {
        return this.getClass('Boolean');
    }

    get Cell(): SdsClass | undefined {
        return this.getClass('Cell', CELL_URI);
    }

    get Column(): SdsClass | undefined {
        return this.getClass('Column', COLUMN_URI);
    }

    get Float(): SdsClass | undefined {
        return this.getClass('Float');
    }

    get Int(): SdsClass | undefined {
        return this.getClass('Int');
    }

    get Image(): SdsClass | undefined {
        return this.getClass('Image', IMAGE_URI);
    }

    get ImageList() : SdsClass | undefined {
        return this.getClass('ImageList', IMAGE_LIST_URI);
    }

    get List(): SdsClass | undefined {
        return this.getClass('List');
    }

    get Map(): SdsClass | undefined {
        return this.getClass('Map');
    }

    get Nothing(): SdsClass | undefined {
        return this.getClass('Nothing');
    }

    get Number(): SdsClass | undefined {
        return this.getClass('Number');
    }

    get Row(): SdsClass | undefined {
        return this.getClass('Row', ROW_URI);
    }

    get String(): SdsClass | undefined {
        return this.getClass('String');
    }

    get Table(): SdsClass | undefined {
        return this.getClass('Table', TABLE_URI);
    }

    get Dataset(): SdsClass | undefined {
        return this.getClass('Dataset', DATASET_URI);
    }

    get TabularDataset(): SdsClass | undefined {
        return this.getClass('TabularDataset', TABULAR_DATASET_URI);
    }


    /**
     * Returns whether the given node is a builtin class.
     */
    isBuiltinClass(node: SdsClass | undefined): boolean {
        return (
            Boolean(node) &&
            [
                this.Any,
                this.Boolean,
                this.Float,
                this.Int,
                this.List,
                this.Map,
                this.Nothing,
                this.Number,
                this.String,
            ].includes(node)
        );
    }

    private getClass(name: string, uri: URI = CORE_CLASSES_URI): SdsClass | undefined {
        return this.getModuleMember(uri, name, isSdsClass);
    }
}
