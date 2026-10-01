function normalizePisiSheetFillRect(rect) {
    if (!rect) return null;

    const rowStart = Math.min(
        Number(rect.rowStart),
        Number(rect.rowEnd)
    );
    const rowEnd = Math.max(
        Number(rect.rowStart),
        Number(rect.rowEnd)
    );
    const colStart = Math.min(
        Number(rect.colStart),
        Number(rect.colEnd)
    );
    const colEnd = Math.max(
        Number(rect.colStart),
        Number(rect.colEnd)
    );

    if (
        !Number.isInteger(rowStart) ||
        !Number.isInteger(rowEnd) ||
        !Number.isInteger(colStart) ||
        !Number.isInteger(colEnd) ||
        rowStart < 0 ||
        colStart < 0
    ) {
        return null;
    }

    return {
        rowStart,
        rowEnd,
        colStart,
        colEnd
    };
}

function getPisiSheetDragFillRect(
    sourceRect,
    targetPoint
) {
    const source =
        normalizePisiSheetFillRect(sourceRect);

    if (
        !source ||
        !Number.isInteger(targetPoint?.row) ||
        !Number.isInteger(targetPoint?.col)
    ) {
        return source;
    }

    return {
        rowStart: Math.min(
            source.rowStart,
            targetPoint.row
        ),
        rowEnd: Math.max(
            source.rowEnd,
            targetPoint.row
        ),
        colStart: Math.min(
            source.colStart,
            targetPoint.col
        ),
        colEnd: Math.max(
            source.colEnd,
            targetPoint.col
        )
    };
}

function isPisiSheetPointInFillRect(
    row,
    col,
    rect
) {
    const normalized =
        normalizePisiSheetFillRect(rect);

    return Boolean(
        normalized &&
        row >= normalized.rowStart &&
        row <= normalized.rowEnd &&
        col >= normalized.colStart &&
        col <= normalized.colEnd
    );
}

function positivePisiSheetModulo(
    value,
    divisor
) {
    return (
        (value % divisor) + divisor
    ) % divisor;
}

function getPisiSheetDragFillSourcePoint(
    sourceRect,
    row,
    col
) {
    const source =
        normalizePisiSheetFillRect(sourceRect);

    if (!source) return null;

    const height =
        source.rowEnd - source.rowStart + 1;
    const width =
        source.colEnd - source.colStart + 1;

    return {
        row:
            source.rowStart +
            positivePisiSheetModulo(
                row - source.rowStart,
                height
            ),
        col:
            source.colStart +
            positivePisiSheetModulo(
                col - source.colStart,
                width
            )
    };
}

function getPisiSheetLinearSeriesStep(values) {
    const numeric = (Array.isArray(values) ? values : [])
        .map((value) => {
            if (
                value === '' ||
                value === null ||
                value === undefined
            ) {
                return null;
            }

            const parsed = Number(value);
            return Number.isFinite(parsed)
                ? parsed
                : null;
        });

    if (
        numeric.length < 2 ||
        numeric.some((value) => value === null)
    ) {
        return null;
    }

    const step =
        numeric[1] - numeric[0];

    for (
        let index = 2;
        index < numeric.length;
        index += 1
    ) {
        if (
            Math.abs(
                numeric[index] -
                numeric[index - 1] -
                step
            ) > 1e-12
        ) {
            return null;
        }
    }

    return step;
}

function getPisiSheetDragFillSeriesValue(
    sourceRect,
    sourceValues,
    row,
    col
) {
    const source =
        normalizePisiSheetFillRect(sourceRect);

    if (!source) return null;

    const height =
        source.rowEnd - source.rowStart + 1;
    const width =
        source.colEnd - source.colStart + 1;

    if (
        width === 1 &&
        height >= 2 &&
        col === source.colStart
    ) {
        const values = Array.from(
            { length: height },
            (_, index) => sourceValues[index]?.[0]
        );
        const step =
            getPisiSheetLinearSeriesStep(values);

        if (step === null) return null;

        if (row < source.rowStart) {
            return (
                Number(values[0]) -
                step * (source.rowStart - row)
            );
        }

        if (row > source.rowEnd) {
            return (
                Number(values.at(-1)) +
                step * (row - source.rowEnd)
            );
        }
    }

    if (
        height === 1 &&
        width >= 2 &&
        row === source.rowStart
    ) {
        const values = Array.from(
            { length: width },
            (_, index) => sourceValues[0]?.[index]
        );
        const step =
            getPisiSheetLinearSeriesStep(values);

        if (step === null) return null;

        if (col < source.colStart) {
            return (
                Number(values[0]) -
                step * (source.colStart - col)
            );
        }

        if (col > source.colEnd) {
            return (
                Number(values.at(-1)) +
                step * (col - source.colEnd)
            );
        }
    }

    return null;
}

export {
    getPisiSheetDragFillRect,
    getPisiSheetDragFillSeriesValue,
    getPisiSheetDragFillSourcePoint,
    getPisiSheetLinearSeriesStep,
    isPisiSheetPointInFillRect,
    normalizePisiSheetFillRect
};
