const fs = require('fs');
const path = require('path');

// Update ASDS Dashboard
function updateASDSDashboard() {
    const filePath = path.join(__dirname, '..', 'public', 'asds-dashboard.html');
    let content = fs.readFileSync(filePath, 'utf8');

    const oldCode = `async function loadDemographics() {\r\n            try {\r\n                const usersResponse = await fetch('/api/all-users');\r\n                const appsResponse = await fetch('/api/all-applications');\r\n\r\n                const usersData = await usersResponse.json();\r\n                const appsData = await appsResponse.json();\r\n\r\n                const users = (usersData && usersData.users) ? usersData.users : [];\r\n                const allApps = (appsData && appsData.applications) ? appsData.applications : [];`;

    const newCode = `async function loadDemographics() {\r\n            let users = [];\r\n            let allApps = [];\r\n            \r\n            // Fetch users (with error handling)\r\n            try {\r\n                const usersResponse = await fetch('/api/all-users');\r\n                if (usersResponse.ok) {\r\n                    const usersData = await usersResponse.json();\r\n                    users = (usersData && usersData.users) ? usersData.users : [];\r\n                }\r\n            } catch (error) {\r\n                console.error('Error loading users:', error);\r\n            }\r\n            \r\n            // Fetch applications (with error handling)\r\n            try {\r\n                const appsResponse = await fetch('/api/all-applications');\r\n                if (appsResponse.ok) {\r\n                    const appsData = await appsResponse.json();\r\n                    allApps = (appsData && appsData.applications) ? appsData.applications : [];\r\n                }\r\n            } catch (error) {\r\n                console.error('Error loading applications:', error);\r\n            }`;

    if (content.includes(oldCode)) {
        content = content.replace(oldCode, newCode);
        fs.writeFileSync(filePath, content);
        console.log('✓ Updated ASDS dashboard');
        return true;
    } else {
        console.log('✗ ASDS dashboard pattern not found');
        return false;
    }
}

// Update SDS Dashboard
function updateSDSDashboard() {
    const filePath = path.join(__dirname, '..', 'public', 'sds-dashboard.html');
    let content = fs.readFileSync(filePath, 'utf8');

    const oldCode = `async function loadDemographics() {\r\n            try {\r\n                const usersResponse = await fetch('/api/all-users');\r\n                const appsResponse = await fetch('/api/all-applications');\r\n\r\n                const usersData = await usersResponse.json();\r\n                const appsData = await appsResponse.json();\r\n\r\n                const users = (usersData && usersData.users) ? usersData.users : [];\r\n                const allApps = (appsData && appsData.applications) ? appsData.applications : [];`;

    const newCode = `async function loadDemographics() {\r\n            let users = [];\r\n            let allApps = [];\r\n            \r\n            // Fetch users (with error handling)\r\n            try {\r\n                const usersResponse = await fetch('/api/all-users');\r\n                if (usersResponse.ok) {\r\n                    const usersData = await usersResponse.json();\r\n                    users = (usersData && usersData.users) ? usersData.users : [];\r\n                }\r\n            } catch (error) {\r\n                console.error('Error loading users:', error);\r\n            }\r\n            \r\n            // Fetch applications (with error handling)\r\n            try {\r\n                const appsResponse = await fetch('/api/all-applications');\r\n                if (appsResponse.ok) {\r\n                    const appsData = await appsResponse.json();\r\n                    allApps = (appsData && appsData.applications) ? appsData.applications : [];\r\n                }\r\n            } catch (error) {\r\n                console.error('Error loading applications:', error);\r\n            }`;

    if (content.includes(oldCode)) {
        content = content.replace(oldCode, newCode);
        fs.writeFileSync(filePath, content);
        console.log('✓ Updated SDS dashboard');
        return true;
    } else {
        console.log('✗ SDS dashboard pattern not found');
        return false;
    }
}

// Also update the catch block to still render charts even on error
function updateErrorHandling(filePath, dashboardName) {
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Update the catch block to render empty state charts
    const oldCatch = `} catch (error) {
                console.error('Error loading demographics:', error);
            }
        }`;
    
    const newCatch = `} catch (error) {
                console.error('Error rendering charts:', error);
            }
            
            // Always render charts (even with empty data to preserve layout)
            createBarChart('departmentBars', departmentCounts || {}, ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF']);
            createDonutChart('statusDonut', statusCounts || { 'Approved': 0, 'Pending': 0, 'Rejected': 0 }, ['#4CAF50', '#FF9800', '#F44336']);
            createVerticalBarChart('leaveTypeBars', leaveTypeCounts || {}, ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF', '#FF9F40']);
            createTop5Chart('topLeaveTakers', top5LeaveTakers || []);
            createHeatmapChart('schoolTrendsHeatmap', schoolMonthlyData || {}, '#667eea');
        }`;
    
    if (content.includes(oldCatch)) {
        content = content.replace(oldCatch, newCatch);
        fs.writeFileSync(filePath, content);
        console.log(`✓ Updated ${dashboardName} error handling`);
        return true;
    }
    return false;
}

// Run updates
console.log('Updating dashboards for resilient layouts...\n');
updateASDSDashboard();
updateSDSDashboard();

console.log('\nDone!');
