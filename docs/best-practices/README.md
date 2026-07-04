# Best Practices and Common Mistakes

When creating a data science pipeline one should consider existing best practices. Best practices include following a
clear [pipeline structure](pipeline-structure.md) to make your pipeline more understandable to other developers, and
avoiding common data science and machine learning mistakes.

To learn about best practices for pipeline structure, see [Pipeline Structure](pipeline-structure.md).

## Avoiding common mistakes

### Data leakage

One of the most common mistakes is *data leakage*. This mistake occurs when information from the test data flows,
directly or indirectly, into the training process. The result is an overly optimistic offline evaluation: the model
looks strong on test data but performs worse in production.

Generally, there are three kinds of data leakage relevant for Safe-DS:

- **Preprocessing leakage:** Transformations such as scaling, normalization, PCA, or feature selection are fitted on the
  whole dataset before splitting, so information about the test distribution leaks into training.

    *Avoid this by splitting first and fitting all transformation parameters only on the training data.*

- **Overlap leakage:** Rows of the test set overlap with the training set, for example through oversampling/augmentation
  (SMOTE) or duplicates applied before the split.

    *Always split first, then apply such steps to the training data only, and keep related records (e.g. multiple entries
    per subject) on the same side of the split.*

- **Multi-test leakage:** The same test data is used repeatedly for decisions like model selection or hyperparameter
  tuning, so it is effectively no longer independent test data.

    *Split cleanly into train / validation / test sets, use validation for all development decisions, and touch the test
    set only once at the very end to assess the generality of your model.*

### Overfitting

Another common mistake is *model overfitting*. This occurs when a model is tuned so closely to a specific dataset that it
captures its idiosyncrasies instead of the underlying pattern, and therefore generalizes poorly.

- **Evaluation on training data:** A frequent reason overfitting goes unnoticed is evaluating a model on the same data it
  was trained on. Performance there is much higher than on real, unseen data, so the poor generalization stays hidden
  (a form of the [data leakage](#data-leakage) discussed above).

    *Therefore, always keep evaluation and training data separate.*

- **Sequential overfitting:** Another cause is repeatedly using the test set to guide model selection, so it gradually
  becomes part of the training process (this is essentially the multi-test leakage described under
  [Data leakage](#data-leakage)).

    *To avoid this, make development decisions on a validation set, keep a separate hold-out test set that is used only
    once, and be cautious about over-interpreting small performance differences, especially when many models or
    configurations are compared.*


### Insufficient preprocessing

A third common mistake is *insufficient preprocessing*, jumping into modeling without properly understanding and
preparing the data. Two aspects matter in particular:

- **Skipping exploratory data analysis (EDA):** Not performing any EDA means missing distributions, outliers, class imbalance, or
  biased/unrepresentative samples that will later distort the model.

    *Take the time to explore and understand the data, and check that the training data actually represents the target
    population.*

- **Omitting data cleaning:** Not performing data cleaning leaves missing values, duplicates, and inconsistent encodings
  in place, so the model learns artifacts rather than real relationships ("garbage in, garbage out").

    *Decide on strategies like imputation or basic removal to handle missing data, and consider outlier and duplicate
    handling based on the domain.*

### Unsuitable evaluation

Finally, a common mistake is *unsuitable evaluation*, in particular choosing the wrong metric. Accuracy is the classic
pitfall on imbalanced classes: with a 90/10 split, a model that always predicts the majority class reaches 90 % accuracy
while being useless.

*Choose metrics that fit the problem (e.g. F1, precision/recall, ROC-AUC, or MCC for imbalanced data), and weigh the real
cost of false positives versus false negatives for your use case.*


## Read more

- Lones, M. A. (2024). *Avoiding common machine learning pitfalls.* Patterns, 5(10), 101046.
  <https://doi.org/10.1016/j.patter.2024.101046>
- Yang, C., Brower-Sinning, R. A., Lewis, G., & Kästner, C. (2022). *Data leakage in notebooks: Static detection and
  better processes.* In Proceedings of the 37th IEEE/ACM International Conference on Automated Software Engineering
  (ASE '22), 1–12. <https://doi.org/10.1145/3551349.3556918>