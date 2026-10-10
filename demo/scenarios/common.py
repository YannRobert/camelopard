"""What the scenarios share: Jira's usual issue types and priorities, drawn by the fake Jira, and the custom
fields the demo configurations map to roles."""

# History entries made by this account show as automation in the detail panel.
BOT = ("automation", "Jira Automation")

# Type id: (name, icon file served under images/icons/demo/).
TYPES = {
    "10001": ("Story", "story.svg"),
    "1": ("Bug", "bug.svg"),
    "3": ("Task", "task.svg"),
}
TYPE_IDS = {name: type_id for type_id, (name, _) in TYPES.items()}
PRIORITIES = {
    "1": ("Highest", "highest.svg"),
    "2": ("High", "high.svg"),
    "3": ("Medium", "medium.svg"),
    "4": ("Low", "low.svg"),
}
PRIORITY_IDS = {name: priority_id for priority_id, (name, _) in PRIORITIES.items()}

# Custom fields, as the demo configurations map them to roles.
FIELDS = {
    "storyPoints": "customfield_10002",
    "sprints": "customfield_10004",
    "criticality": "customfield_10200",
    "developer": "customfield_10201",
    "tester": "customfield_10202",
    "environments": "customfield_10203",
    "deliveredAt": "customfield_10204",
    "installedAt": "customfield_10205",
    "acceptedAt": "customfield_10206",
}
