export interface TimelineLine {
    time: number
}

export interface StabilizedTimeline {
    times: number[]
    protectedGaps: number
}

function median(values: number[], fallback: number) {
    if (!values.length) return fallback
    const sorted = [...values].sort((left, right) => left - right)
    const middle = Math.floor(sorted.length / 2)
    return sorted.length % 2 === 0
        ? (sorted[middle - 1] + sorted[middle]) / 2
        : sorted[middle]
}

export function stabilizeInterludeGaps(lines: TimelineLine[], candidateTimes: number[]): StabilizedTimeline {
    if (!lines.length || lines.length !== candidateTimes.length) {
        return { times: [...candidateTimes], protectedGaps: 0 }
    }

    const sourceGaps = lines.slice(1).map((line, index) => Math.max(0, line.time - lines[index].time))
    const typicalGap = median(sourceGaps.filter(gap => gap >= 0.35 && gap <= 6), 2.8)
    const interludeThreshold = Math.max(7, typicalGap * 2.8)
    const localRatios = sourceGaps.flatMap((sourceGap, index) => {
        const candidateGap = candidateTimes[index + 1] - candidateTimes[index]
        if (sourceGap < 0.35 || sourceGap >= interludeThreshold || candidateGap <= 0) return []
        const ratio = candidateGap / sourceGap
        return ratio >= 0.65 && ratio <= 1.45 ? [ratio] : []
    })
    const timelineRatio = Math.max(0.75, Math.min(1.3, median(localRatios, 1)))

    const firstCandidate = Number.isFinite(candidateTimes[0]) ? candidateTimes[0] : lines[0].time * timelineRatio
    const times = [Math.max(0, firstCandidate)]
    let suffixShift = 0
    let protectedGaps = 0

    for (let index = 1; index < lines.length; index++) {
        const sourceGap = sourceGaps[index - 1]
        const rawCandidate = Number.isFinite(candidateTimes[index])
            ? candidateTimes[index]
            : lines[index].time * timelineRatio
        let candidate = Math.max(0, rawCandidate + suffixShift)
        const previous = times[index - 1]

        if (sourceGap >= interludeThreshold) {
            const minimumInterludeGap = Math.max(4.5, sourceGap * timelineRatio * 0.72)
            const deficit = minimumInterludeGap - (candidate - previous)
            if (deficit > 0.25) {
                suffixShift += deficit
                candidate += deficit
                protectedGaps++
            }
        }

        const minimumLineGap = sourceGap < 0.35 ? 0.05 : Math.min(0.3, sourceGap * 0.2)
        if (candidate < previous + minimumLineGap) {
            const correction = previous + minimumLineGap - candidate
            suffixShift += correction
            candidate += correction
        }
        times.push(candidate)
    }

    return { times, protectedGaps }
}
