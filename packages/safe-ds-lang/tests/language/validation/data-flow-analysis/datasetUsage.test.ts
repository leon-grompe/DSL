import { describe, expect, it } from 'vitest';
import { isSdsPipeline } from '../../../../src/language/generated/ast.js';
import { createSafeDsServices } from '../../../../src/language/index.js';
import { NodeFileSystem } from 'langium/node';
import { getNodeOfType } from '../../../helpers/nodeFinder.js';
import { testDataUsedForTraining } from '../../../../src/language/validation/data-flow-analysis/datasetUsage.js';

const services = (await createSafeDsServices(NodeFileSystem)).SafeDs;

// Helper: collect all validation messages emitted for a pipeline
async function getDiagnosticsFor(code: string): Promise<{ message: string; nodeText?: string }[]> {
    const pipeline = await getNodeOfType(services, code, isSdsPipeline);
    const diagnostics: { message: string; nodeText?: string }[] = [];
    const validator = testDataUsedForTraining(services);

    const accept = (severity: string, message: string, opts?: { node?: object }) => {
        const nodeText = (opts?.node as any)?.$cstNode?.text;
        diagnostics.push({ message, nodeText });
    };

    validator(pipeline, accept as any);
    return diagnostics;
}

describe('testDataUsedForTraining', () => {
    it('does not warn when training set is passed directly to fit', async () => {
        const code = `
            package test
            fun getTable() -> result: Table
            fun fit(t: Table) -> result: Int
            pipeline myPipeline {
                val data = getTable();
                val trainingSet, val testSet = data.splitRows(percentageInFirst = 0.8);
                val imputer = SimpleImputer(SimpleImputer.Strategy.Median);
                val fitted = imputer.fit(trainingSet);
            }
        `;
        const diagnostics = await getDiagnosticsFor(code);
        expect(diagnostics).toHaveLength(0);
    });

    it('warns when test set is passed to fit', async () => {
        const code = `
            package test
            fun getTable() -> result: Table
            fun fit(t: Table) -> result: Int
            pipeline myPipeline {
                val data = getTable();
                val trainingSet, val testSet = data.splitRows(percentageInFirst = 0.8);
                val imputer = SimpleImputer(SimpleImputer.Strategy.Median);
                val fitted = imputer.fit(testSet);
            }
        `;
        const diagnostics = await getDiagnosticsFor(code);
        expect(diagnostics.length).toBeGreaterThan(0);
    });

    it('does not warn when classifier is a variable and training set is passed to fit', async () => {
        // classifier variable is created first, then .fit() is called as a separate statement
        const code = `
            package test
            fun getTable() -> result: Table
            fun fit(t: Table) -> result: Int
            pipeline myPipeline {
                val data = getTable();
                val trainingSet, val testSet = data.splitRows(percentageInFirst = 0.8);
                val imputer = SimpleImputer(SimpleImputer.Strategy.Median);
                val fittedImputer = imputer.fit(trainingSet);
            }
        `;
        const diagnostics = await getDiagnosticsFor(code);
        expect(diagnostics).toHaveLength(0);
    });

    it('does not warn when training set flows through a segment into fit', async () => {
        const code = `
            package test
            fun getTable() -> result: Table
            segment process(t: Table) -> result: Table {
                yield result = t;
            }
            fun fit(t: Table) -> result: Int
            pipeline myPipeline {
                val data = getTable();
                val rawTraining, val rawTest = data.splitRows(percentageInFirst = 0.7);
                val trainingSet = process(rawTraining);
                val imputer = SimpleImputer(SimpleImputer.Strategy.Median);
                val fitted = imputer.fit(trainingSet);
            }
        `;
        const diagnostics = await getDiagnosticsFor(code);
        expect(diagnostics).toHaveLength(0);
    });

    it('does not warn for classifier.fit(trainingSet) where trainingSet is a TabularDataset from a segment', async () => {
        // Mirrors the titanic-2.sds example: rawTraining -> preprocessAfterSplit -> trainingSet:TabularDataset -> classifier.fit
        const code = `
            package test
            from safeds.data.tabular.containers import Table
            from safeds.data.tabular.transformation import SimpleImputer, OneHotEncoder
            from safeds.ml.classical.classification import GradientBoostingClassifier
            segment preprocessAfterSplit(
                table: Table,
                imputer: SimpleImputer,
                encoder: OneHotEncoder
            ) -> dataset: TabularDataset {
                yield dataset = table
                    .transformTable(imputer)
                    .transformTable(encoder)
                    .toTabularDataset(targetName = "label", extraNames = []);
            }
            pipeline myPipeline {
                val rawData = Table.fromCsvFile("data.csv");
                val preprocessed = rawData.removeColumns(["id"]);
                val rawTraining, val rawTest = preprocessed.splitRows(percentageInFirst = 0.7);
                val imputer = SimpleImputer(SimpleImputer.Strategy.Median, columnNames = ["age"]).fit(rawTraining);
                val encoder = OneHotEncoder(columnNames = ["sex"]).fit(rawTraining);
                val trainingSet = preprocessAfterSplit(rawTraining, imputer, encoder);
                val testSet = preprocessAfterSplit(rawTest, imputer, encoder);
                val classifier = GradientBoostingClassifier(treeCount = 10, learningRate = 0.2).fit(trainingSet);
            }
        `;
        const diagnostics = await getDiagnosticsFor(code);
        expect(diagnostics).toHaveLength(0);
    });
});
