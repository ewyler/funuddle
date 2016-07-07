'use strict';

const TEAM_NAME_REGEX = /Firecod/;
const MILLISECONDS_PER_DAY = 1000 * 60 * 60 * 24;

const https = require('https');

const createOptions = (path) => {
    return {
        host: 'hourlynerd.unfuddle.com',
        path: path,
        protocol: 'https:',
        method: 'GET',
        auth: '<redacted>:<redacted>',
        headers: {
            Accept: 'application/json'
        },
    };
};

const get = (path) => {
     return new Promise((resolve, reject) => {
        let options = createOptions(path);

        https.request(options, (response) => {
            let buffer = ""
            response.on('data', (chunk) => {
                buffer += chunk;
            });

            response.on('end', (error) => {
                if (error) {
                    console.log(error);
                    reject();
                }

                resolve(JSON.parse(buffer));
            });
        }).end();
    })
 };

 // For our single project, get several milestones for a given team name.
 // For each milestone, compute the lead time of tickets (currently defined as "in milestone" to "reviewed").
 // Compute average lead time, 95% lead time, 90% lead time, etc.

 // This doesn't do a good job (or any job) of dealing with edge cases around a ticket being moved between multiple boards.

get('/api/v1/projects')
    .then((projects) => {
        // Get finished milestones. We archive them.

        const projectId = projects[0].id;
        return get(`/api/v1/projects/${projectId}/milestones/archived`);
    })
    .then((milestones) => {
        // Get the tickets for all milestones for the given team regex.

        const teamMilestones = milestones.filter((milestone) => new RegExp(TEAM_NAME_REGEX).test(milestone.title));
        console.log(teamMilestones.map((milestone) => milestone.title));

        return Promise.all(
            teamMilestones.map((milestone) => {
                return get(`/api/v1/projects/${milestone.project_id}/milestones/${milestone.id}/tickets`);
            })
        );
    })
    .then((ticketBuckets) => {
        // Get the audit trail for every ticket.

        const allTickets = ticketBuckets.reduce(
            (previous, current) => {
                return previous.concat(current);
            },
            []
        );
        console.log(allTickets.map((ticket) => ticket.id));

        return Promise.all(
            allTickets.map((ticket) => {
                return get(`/api/v1/projects/${ticket.project_id}/tickets/${ticket.id}/audit_trail`);
            })
        );
    })
    .then((ticketAuditTrails) => {
        // Compute lead times.

        const leadTimes = [];

        const statusToClosedRegex = /changed from .*? to \*Reviewed\*/;
        const milestoneEnteredRegex = /\*\*Milestone\*\*/;

        for (let auditTrail of ticketAuditTrails) {
            let closedDate = null;
            let earliestMilestoneDate = null;

            for (let auditEntry of auditTrail) {
                // Items in the audit trail are ordered from most recent to least recent.
                const description = auditEntry.description;

                if (statusToClosedRegex.test(description)) {
                    closedDate = new Date(auditEntry.created_at);
                }

                if (milestoneEnteredRegex.test(description) && TEAM_NAME_REGEX.test(description)) {
                    earliestMilestoneDate = new Date(auditEntry.created_at);
                }
            }

            const leadTimeDays = (closedDate - earliestMilestoneDate) / MILLISECONDS_PER_DAY;

            // Ignore tickets with very small or negative lead times
            // (negatives are likely due to tickets that were never closed, which I'm just ignoring for now).
            if (leadTimeDays > 0.05) {
                leadTimes.push(leadTimeDays);
            }
        }

        const averageLeadTimeDays = leadTimes.reduce((p, c) => p + c) / leadTimes.length;

        leadTimes.sort((a, b) => a - b);
        console.log(leadTimes);

        const percentiles = [.95, .90, .80, .50].map(
            (percentile) => [percentile, leadTimes[Math.floor((leadTimes.length - 1) * percentile)]]
        );

        console.log(`Average lead time: ${averageLeadTimeDays}`);

        for (let pair of percentiles) {
            console.log(`${pair[0]} percentile: ${pair[1]}`);
        }
    })
    .catch((error) => {
        console.log(error);
    });