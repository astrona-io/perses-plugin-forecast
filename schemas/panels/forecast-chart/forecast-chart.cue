package model

import (
	"github.com/perses/shared/cue/common"
)

#queryIndex: int & >=0
// Seconds ("3600") or a Prometheus duration ("7d", "1h30m").
#duration: =~"^([0-9]*\\.?[0-9]+|([0-9]+(ms|s|m|h|d|w|y))+)$"

kind: "ForecastChart"
spec: close({
	// Which query (0-based) plays which role. Unset roles keep their default: actual 0, forecast 1,
	// upper 2, lower 3, anomaly 4.
	roles?: close({
		actual?:   #queryIndex
		forecast?: #queryIndex
		upper?:    #queryIndex
		lower?:    #queryIndex
		anomaly?:  #queryIndex
	})
	// Label on forecast, upper and lower series that says how far ahead a sample is. Default "horizon".
	horizonLabel?: string & =~"^[a-zA-Z_][a-zA-Z0-9_]*$"
	// The line the forecast is checked against.
	threshold?: close({
		value:      number
		label?:     string
		direction?: "above" | "below"
	})
	// An anomaly-role sample above this is an anomaly. Default 0.5.
	anomalyThreshold?: number
	band?: close({
		opacity?: number & >=0 & <=1
		label?:   string
	})
	// Holt-Winters estimate in the browser when no forecast is given. Default false.
	quickStart?: bool
	// How far the quick-start estimate looks ahead. Default "7d".
	horizon?: #duration
	// Callout for when the forecast crosses the threshold. Default true.
	crossingCallout?: bool
	// Opened from an anomaly marker. ${__time}, ${__time_from}, ${__time_to},
	// ${__series.labels.<name>} and dashboard variables are replaced.
	anomalyLink?: string
	format?:      common.#format
	legend?:      common.#legend
})
