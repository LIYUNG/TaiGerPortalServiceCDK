import { CronJobConfig } from "../types";

export const CRON_JOBS: CronJobConfig[] = [
    {
        jobType: "MongoDBDataPipelineDailySnapshot",
        schedule: {
            minute: "10",
            hour: "1",
            day: "*",
            month: "*",
            year: "*"
        },
        description: "Daily snapshot of MongoDB data pipeline"
    },
    {
        jobType: "MongoDBDatabaseDailySnapshot",
        schedule: {
            minute: "25",
            hour: "1",
            day: "*",
            month: "*",
            year: "*"
        },
        description: "Daily snapshot of MongoDB database"
    },
    {
        jobType: "AssignEditorTasksReminderEmails",
        schedule: {
            minute: "20",
            hour: "23",
            day: "*",
            month: "*",
            year: "*"
        },
        description: "Assign Editor reminder for editor manager"
    }
    // Add new jobs here easily
];
