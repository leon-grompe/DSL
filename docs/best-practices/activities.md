# Activities

Every function in the standard library that matters to the behaviour protocol is tagged with one or more **activities**
via the `@PipelineActivity` annotation. An activity names both the *phase* it belongs to and the *kind* of work it does.

## Naming

Activity names follow the pattern `PhaseQType`, where the letter `Q` separates the phase from the activity type — for
example, `DataAcquisitionQDataLoading` is the *data loading* activity of the *Data Acquisition* phase.

The same activity *type* can appear in several phases. *Exploration*, for instance, exists both before the split (as
`DataPreparationQExploration`) and after it (as `DataProcessingQExploration`). The table below lists each activity type
once, together with the phases it appears in and what it does.

!!! info "Experimental"

    Activities are **experimental** and defined in the `safeds.lang` builtin module. The exact set may change.

## Activity reference

| Activity | Phases | Description |
|----------|--------|-------------|
| `DataLoading` | Data Acquisition | Import data from external files. |
| `DatatypeConstruction` | Data Acquisition, Feature Engineering | Build data by hand (e.g. a `Table` or `Column`). |
| `Utilities` | Data Acquisition, Data Preparation, Data Processing, Feature Engineering | Helper operations for many different contexts. |
| `Exploration` | Data Preparation, Data Processing | Exploratory data analysis (statistics, plots, …). |
| `PreSplitCleaning` | Data Preparation | Deterministic pre-split cleaning (row removal). |
| `SchemaModification` | Data Preparation, Data Processing, Feature Engineering, Feature Selection | Change the column structure (rename/add/remove, join). |
| `DataSplitting` | Data Partitioning | Split the dataset into training, test, and (optionally) validation sets. |
| `PostSplitCleaning` | Data Processing | Distribution-based cleaning (row removal). |
| `Augmentation` | Data Processing | Grow or vary the training data. |
| `DataTransformation` | Data Processing | Transform existing values with transformers (scale, impute). |
| `Engineering` | Feature Engineering | Derive or add new feature columns. |
| `FeatureTransformation` | Feature Engineering | Create new feature representations with transformers (encode, discretize). |
| `TabularDatasetConversion` | Feature Selection | Convert a table into a tabular dataset and choose target and features. |
| `ModelCreation` | Modeling | Construct a model or network layers. |
| `ModelFitting` | Training | Train the model on the training set. |
| `Prediction` | Evaluation, Testing | Run the model on held-out data and predict the target column. |
| `MetricCalculation` | Evaluation, Testing | Compute numeric performance scores. |
| `PostProcessing` | Interpretation | Post-process features to derive information (inverse-transform feature columns). |
| `Visualization` | Interpretation | Plot the model. |

!!! note "Augmentation"

    The `Augmentation` activity currently has no functions attached to it, since there are no specific augmentation
    operations in the standard library yet. It is reserved for future use.

## The wildcard

| Activity | Meaning |
|----------|---------|
| `Any` | A wildcard that matches in any phase. Used sparingly for functions that do not belong to a single phase. |

## Data-partition restrictions

Some activities may only touch a specific data partition after the split — for example, `Exploration`,
`PostSplitCleaning`, and `Augmentation` are restricted to the *training* set, while `Prediction` and `MetricCalculation`
are split between the *validation* set (Evaluation phase) and the *test* set (Testing phase). Safe-DS reports a **dataset
mismatch** error when an activity touches the wrong partition. See
[Data-partition rules](pipeline-structure.md#data-partition-rules) for the full list and the reasoning behind it.

## See also

- [API by Activity](../api/by-activity.md) — a lookup of every API operation grouped by the activity it performs.
- [Pipeline Structure](pipeline-structure.md) — how these activities are ordered into phases and layers.
