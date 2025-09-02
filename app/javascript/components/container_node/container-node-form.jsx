import React, { useState, useEffect } from 'react';
import { Grid } from 'carbon-components-react';
import MiqFormRenderer from '@@ddf';
import miqRedirectBack from '../../helpers/miq-redirect-back';
import createSchema from './container-node-form.schema';

const ContainerNodeForm = ({ recordId, mode = 'create' }) => {
  const [{ emsId }, setState] = useState({emsId: null});
  const [initialValues, setInitialValues] = useState({});
  const [loading, setLoading] = useState(false);

  // Helper function to convert object to field array format
  const objectToFieldArray = (obj) => {
    if (!obj || typeof obj !== 'object') return [];
    return Object.entries(obj).map(([key, value]) => ({ key, value }));
  };

  // Helper function to convert field array to object format
  const fieldArrayToObject = (array) => {
    if (!Array.isArray(array)) return {};
    const result = {};
    array.forEach(({ key, value }) => {
      if (key && key.trim()) {
        result[key] = value || '';
      }
    });
    return result;
  };

  useEffect(() => {
    if (mode === 'edit' && recordId) {
      setLoading(true);
      miqSparkleOn();

      // Get node metadata for edit mode
      API.post(`/api/container_nodes/${recordId}`, {
        action: 'get_metadata'
      })
        .then((response) => {
          const node = response;
          const labels = node.labels || {};
          const annotations = node.annotations || {};
          const extManagementSystem = node.ext_management_system || {};
          const conditions = node.container_conditions || [];
          const schedulable = node.schedulable !== false;

          console.log('Node data loaded:', node);

          const labelsArray = objectToFieldArray(labels);
          const annotationsArray = objectToFieldArray(annotations);

          setInitialValues({
            node_name: node.name || '',
            hostname: node.hostname || 'Unknown',
            container_runtime_version: node.container_runtime_version || 'Unknown',
            kubernetes_version: node.kubernetes_version || 'Unknown',
            operating_system: node.operating_system || 'Unknown',
            kernel_version: node.kernel_version || 'Unknown',
            container_provider: extManagementSystem.name || 'Unknown',
            max_container_groups: parseInt(node.max_container_groups) || 0,
            schedulable: schedulable,
            labels: labelsArray,
            annotations: annotationsArray
          });

          setState({
            emsId: extManagementSystem.id
          });
        })
        .catch((error) => {
          console.error('Error loading node data:', error);
          let errorMessage = __('Failed to load node data');
          if (error && error.data && error.data.error && error.data.error.message) {
            errorMessage = error.data.error.message;
          }
          miqRedirectBack(errorMessage, 'error', '/container_node/show_list');
        })
        .finally(() => {
          setLoading(false);
          miqSparkleOff();
        });
    } else if (mode === 'create') {
      setInitialValues({
        ems_id: '',
        yaml_content: ''
      });
    }
  }, [mode, recordId]);

  const onSubmit = (values) => {
    miqSparkleOn();
    console.log('Form submitted with values:', values);

    let request;
    if (mode === 'create') {
      // Create new node using YAML
      request = API.post('/api/container_nodes', {
        action: 'create',
        resource: {
          ems_id: values.ems_id,
          yaml_content: values.yaml_content
        }
      });
    } else {
      // Update existing node using structured data
      const labels = fieldArrayToObject(values.labels || []);
      const annotations = fieldArrayToObject(values.annotations || []);

      request = API.post(`/api/container_nodes/${recordId}`, {
        action: 'edit',
        resource: {
          labels: labels,
          annotations: annotations,
          max_container_groups: values.max_container_groups,
          schedulable: values.schedulable,
        }
      });
    }

    request.then((response) => {
      const message = mode === 'create'
        ? __('Creation of Node has been successfully queued.')
        : __('Update of Node has been successfully queued.');
      const redirectUrl = mode === 'create'
        ? '/container_node/show_list'
        : `/container_node/show/${recordId}`;
      miqRedirectBack(message, 'success', redirectUrl);
    }).catch((error) => {
      miqSparkleOff();
      console.error('Error submitting form:', error);

      let errorMessage = __('An error occurred');
      if (error && error.data) {
        if (error.data.error && error.data.error.message) {
          errorMessage = error.data.error.message;
        } else if (typeof error.data.error === 'string') {
          errorMessage = error.data.error;
        } else if (typeof error.data === 'string') {
          errorMessage = error.data;
        }
      }

      miqFlashLater({ message: errorMessage, level: 'error' });
    });
  };

  const onCancel = () => {
    const message = mode === 'create'
      ? __('Creation of new Node was canceled by the user.')
      : __('Edit of Node was canceled by the user.');
    const redirectUrl = mode === 'create'
      ? '/container_node/show_list'
      : `/container_node/show/${recordId}`;
    miqRedirectBack(message, 'warning', redirectUrl);
  };

  console.log('Form initial values:', initialValues);
  console.log('createSchema:', emsId, setState, mode);

  if (loading) {
    return <div>Loading node data...</div>;
  }

  if (mode === 'edit' && Object.keys(initialValues).length === 0) {
    return <div>Waiting for data...</div>;
  }

  return (
    <Grid>
      <MiqFormRenderer
        initialValues={initialValues}
        schema={createSchema(emsId, setState, mode)}
        onSubmit={onSubmit}
        onCancel={onCancel}
        buttonsLabels={{
          submitLabel: mode === 'create' ? __('Create') : __('Save'),
          cancelLabel: __('Cancel')
        }}
        canSubmit={mode === 'edit' ? ({ valid }) => valid : undefined}
      />
    </Grid>
  );
};

export default ContainerNodeForm;